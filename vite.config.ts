import { defineConfig, type Connect, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { cloudflare } from "@cloudflare/vite-plugin";

const SOFFICE = ['/Applications/LibreOffice.app/Contents/MacOS/soffice', '/usr/bin/soffice', '/usr/local/bin/soffice'].find(existsSync)
const MAX_BYTES = 80 * 1024 * 1024

/**
 * POST /api/convert-to-pdf — a PowerPoint, Keynote or OpenDocument presentation in the
 * body, PDF back. Browsers can't render those formats, so the dev and preview servers
 * convert with LibreOffice when it is installed on the machine running them.
 */
const convertToPdf: Connect.NextHandleFunction = (req, res, next) => {
  if (req.url !== '/api/convert-to-pdf') return next()
  if (req.method !== 'POST') {
    res.statusCode = 405
    return res.end()
  }
  if (!SOFFICE) {
    res.statusCode = 501
    return res.end('LibreOffice is not installed on the server')
  }
  const name = path.basename(decodeURIComponent(String(req.headers['x-filename'] ?? 'slides.pptx'))).replace(/[^\w.\- ]/g, '_')
  if (!/\.(pptx?|key|odp)$/i.test(name)) {
    res.statusCode = 415
    return res.end('Unsupported file type')
  }
  const chunks: Buffer[] = []
  let size = 0
  req.on('data', (c: Buffer) => {
    size += c.length
    if (size > MAX_BYTES) req.destroy()
    else chunks.push(c)
  })
  req.on('end', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'deck-'))
    try {
      await writeFile(path.join(dir, name), Buffer.concat(chunks))
      await new Promise<void>((resolve, reject) =>
        execFile(
          SOFFICE,
          [`-env:UserInstallation=file://${path.join(dir, 'profile')}`, '--headless', '--convert-to', 'pdf', '--outdir', dir, path.join(dir, name)],
          { timeout: 180_000 },
          (err) => (err ? reject(err) : resolve()),
        ),
      )
      const pdf = (await readdir(dir)).find((f) => f.toLowerCase().endsWith('.pdf'))
      if (!pdf) throw new Error('no PDF produced')
      res.setHeader('Content-Type', 'application/pdf')
      res.end(await readFile(path.join(dir, pdf)))
    } catch {
      res.statusCode = 422
      res.end('Conversion failed')
    } finally {
      void rm(dir, { recursive: true, force: true })
    }
  })
}

/**
 * MediaPipe's face-tracking runtime, served from the app (`/models/mediapipe/wasm/`) rather than a
 * CDN, so it works offline and inside the iOS app. Dev serves it from node_modules; builds copy it.
 */
const MEDIAPIPE_WASM = path.resolve(__dirname, 'node_modules/@mediapipe/tasks-vision/wasm')
const MEDIAPIPE_URL = '/models/mediapipe/wasm/'
const MEDIAPIPE_FILES = ['vision_wasm_internal.js', 'vision_wasm_internal.wasm', 'vision_wasm_nosimd_internal.js', 'vision_wasm_nosimd_internal.wasm']

const mediapipeRuntime = (): Plugin => ({
  name: 'mediapipe-runtime',
  configureServer: (server) =>
    void server.middlewares.use(async (req, res, next) => {
      const name = req.url?.startsWith(MEDIAPIPE_URL) ? req.url.slice(MEDIAPIPE_URL.length).split('?')[0] : ''
      if (!MEDIAPIPE_FILES.includes(name)) return next()
      res.setHeader('Content-Type', name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript')
      res.end(await readFile(path.join(MEDIAPIPE_WASM, name)))
    }),
  generateBundle: async function () {
    for (const name of MEDIAPIPE_FILES) {
      this.emitFile({ type: 'asset', fileName: `models/mediapipe/wasm/${name}`, source: await readFile(path.join(MEDIAPIPE_WASM, name)) })
    }
  },
})

const deckConverter = (): Plugin => ({
  name: 'deck-converter',
  configureServer: (server) => void server.middlewares.use(convertToPdf),
  configurePreviewServer: (server) => void server.middlewares.use(convertToPdf),
})

// Local API (uvicorn app.main:create_app --factory --port 8000), including the live WebSocket.
const apiProxy = { '/api/v1': { target: 'http://127.0.0.1:8000', ws: true } }

export default defineConfig({
  plugins: [react(), tailwindcss(), deckConverter(), mediapipeRuntime(), cloudflare()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    proxy: apiProxy,
    // Only the web app's files should reload the page; editing the backend, infrastructure or
    // docs must not reset what the user is doing in the browser.
    watch: {
      ignored: ['**/backend/**', '**/infra/**', '**/docs/**', '**/firebase/**', '**/ios/**', '**/.local-objects/**'],
    },
  },
  preview: { proxy: apiProxy },
})