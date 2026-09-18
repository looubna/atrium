import { describe, expect, it } from 'vitest'
import { nextOffset, uploadResumable, UploadError } from '../resumableUpload'

const KIB = 256 * 1024

type Reply = Response | Error

function server(replies: Reply[]) {
  const ranges: string[] = []
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    ranges.push(new Headers(init?.headers).get('Content-Range') ?? '')
    const reply = replies.shift()
    if (!reply) throw new Error('unexpected request')
    if (reply instanceof Error) throw reply
    return reply
  }) as typeof fetch
  return { ranges, fetchImpl }
}

const incomplete = (lastByte: number | null) =>
  new Response(null, { status: 308, headers: lastByte === null ? {} : { Range: `bytes=0-${lastByte}` } })
const complete = () => new Response(null, { status: 200 })
const noSleep = async () => {}

describe('nextOffset', () => {
  it('continues after the last stored byte', () => {
    expect(nextOffset('bytes=0-262143')).toBe(262144)
  })

  it('starts over when nothing is stored or the header is malformed', () => {
    expect(nextOffset(null)).toBe(0)
    expect(nextOffset('bytes=10-20')).toBe(0)
  })
})

describe('uploadResumable', () => {
  it('sends consecutive chunks until the server reports completion', async () => {
    const blob = new Blob([new Uint8Array(2 * KIB + 100)])
    const { ranges, fetchImpl } = server([incomplete(KIB - 1), incomplete(2 * KIB - 1), complete()])
    const progress: number[] = []
    await uploadResumable('https://upload', blob, 'video/mp4', {
      chunkBytes: KIB,
      fetchImpl,
      onProgress: (sent) => progress.push(sent),
    })
    expect(ranges).toEqual([
      `bytes 0-${KIB - 1}/${blob.size}`,
      `bytes ${KIB}-${2 * KIB - 1}/${blob.size}`,
      `bytes ${2 * KIB}-${blob.size - 1}/${blob.size}`,
    ])
    expect(progress.at(-1)).toBe(blob.size)
  })

  it('asks the server for its progress after a network error and resumes from there', async () => {
    const blob = new Blob([new Uint8Array(3 * KIB)])
    const { ranges, fetchImpl } = server([
      incomplete(KIB - 1),
      new TypeError('network down'),
      incomplete(2 * KIB - 1), // the failed chunk had actually arrived
      complete(),
    ])
    await uploadResumable('https://upload', blob, 'video/mp4', { chunkBytes: KIB, fetchImpl, sleep: noSleep })
    expect(ranges).toEqual([
      `bytes 0-${KIB - 1}/${blob.size}`,
      `bytes ${KIB}-${2 * KIB - 1}/${blob.size}`,
      `bytes */${blob.size}`,
      `bytes ${2 * KIB}-${3 * KIB - 1}/${blob.size}`,
    ])
  })

  it('retries server errors and gives up after the retry limit', async () => {
    const blob = new Blob([new Uint8Array(KIB)])
    const replies: Reply[] = []
    for (let i = 0; i < 3; i++) replies.push(new Response(null, { status: 503 }), incomplete(null))
    const { fetchImpl } = server(replies)
    await expect(
      uploadResumable('https://upload', blob, 'video/mp4', { chunkBytes: KIB, fetchImpl, sleep: noSleep, maxRetries: 2 }),
    ).rejects.toBeInstanceOf(UploadError)
  })

  it('stops immediately when the upload is rejected', async () => {
    const blob = new Blob([new Uint8Array(10)])
    const { ranges, fetchImpl } = server([new Response(null, { status: 403 })])
    await expect(uploadResumable('https://upload', blob, 'video/mp4', { chunkBytes: KIB, fetchImpl })).rejects.toMatchObject({
      status: 403,
    })
    expect(ranges).toHaveLength(1)
  })

  it('refuses empty files and chunk sizes Cloud Storage would reject', async () => {
    await expect(uploadResumable('https://upload', new Blob([]), 'video/mp4')).rejects.toBeInstanceOf(UploadError)
    await expect(
      uploadResumable('https://upload', new Blob([new Uint8Array(10)]), 'video/mp4', { chunkBytes: 1000 }),
    ).rejects.toBeInstanceOf(UploadError)
  })
})
