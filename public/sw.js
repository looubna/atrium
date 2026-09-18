/**
 * Minimal service worker — enough to make the app installable and to survive a
 * flaky connection, without pulling in a build plugin.
 *
 * Navigations go network-first so a new deploy is picked up immediately;
 * hashed assets go cache-first because their URL changes when they do.
 */
// Bump when files under public/ change in place (the people models keep their
// URLs when rebuilt): activation then drops the old cache.
const CACHE = 'atrium-v5'

/**
 * `ignoreVary` is load-bearing. Static servers commonly send `Vary: Origin`,
 * and cache matching honours it: an entry stored via `cache.add(url)` is keyed
 * to a request with no Origin header, while the page's own module-script
 * requests are CORS-mode and do send one. Without this every lookup misses and
 * the app silently fails to boot offline.
 */
const MATCH = { ignoreVary: true }

const put = async (request, response) => {
  if (!response.ok || response.type !== 'basic') return
  const cache = await caches.open(CACHE)
  await cache.put(request, response)
}

self.addEventListener('install', (event) => {
  self.skipWaiting()
  // The very first navigation happens before this worker exists, so nothing
  // would cache the app shell unless we fetch it ourselves.
  event.waitUntil(caches.open(CACHE).then((c) => c.add('/').catch(() => {})))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

/**
 * The page tells us what it already loaded. Without this, the assets fetched
 * during the first visit are never seen by this worker — they were requested
 * before it took control — and the app would only work offline from the
 * second visit onward.
 */
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'cache-urls' || !Array.isArray(event.data.urls)) return
  event.waitUntil(
    caches.open(CACHE).then((c) =>
      Promise.all(event.data.urls.map((u) => c.add(u).catch(() => {}))),
    ),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  if (new URL(request.url).origin !== self.location.origin) return
  // API responses are private, per-user and live: never cache them.
  if (new URL(request.url).pathname.startsWith('/api/')) return
  // Video is fetched in byte ranges, which the Cache API cannot store (206):
  // leave it to the network and the browser's own cache.
  if (request.headers.has('range') || request.destination === 'video') return
  // Meeting-room footage is replaced in place under the same names (new poster,
  // new clips): never serve it from the cache, or an old picture sticks.
  if (new URL(request.url).pathname.startsWith('/video/')) return

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(request)
          void put(request, res.clone())
          return res
        } catch {
          return (
            (await caches.match(request, MATCH)) ??
            (await caches.match('/', MATCH)) ??
            Response.error()
          )
        }
      })(),
    )
    return
  }

  event.respondWith(
    (async () => {
      const hit = await caches.match(request, MATCH)
      if (hit) return hit
      const res = await fetch(request)
      void put(request, res.clone())
      return res
    })(),
  )
})
