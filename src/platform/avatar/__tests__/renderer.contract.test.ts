import { describe, expect, it, vi } from 'vitest'
import { NoneRenderer } from '../noneRenderer'
import type { AvatarRenderer, AvatarState } from '../types'

/**
 * Every provider must behave the same way from the call's point of view, so the
 * live hook can swap one for another — including for our own GPU renderer later.
 * This fake stands in for a provider in the hook's tests.
 */
class FakeRenderer implements AvatarRenderer {
  /** A provider that does not speak for itself: our player stays audible, delayed to match. */
  readonly providesAudio = false
  readonly videoLagMs = 180
  attached: HTMLVideoElement | null = null
  chunks: { turnSeq: number; samples: number }[] = []
  states: AvatarState[] = []
  interrupts = 0
  disposed = false
  failAttach = false

  async attach(video: HTMLVideoElement): Promise<void> {
    if (this.failAttach) throw new Error('provider unavailable')
    this.attached = video
  }
  pushAudio(turnSeq: number, pcm: Int16Array): void {
    this.chunks.push({ turnSeq, samples: pcm.length })
  }
  interrupt(): void {
    this.interrupts++
    this.chunks = []
  }
  setState(state: AvatarState): void {
    this.states.push(state)
  }
  dispose(): void {
    this.disposed = true
    this.attached = null
  }
}

const video = () => ({ muted: true }) as HTMLVideoElement

/** What the live hook is allowed to assume of any renderer. */
function contract(name: string, make: () => AvatarRenderer) {
  describe(name, () => {
    it('accepts audio, state changes and interrupts without throwing', async () => {
      const renderer = make()
      await renderer.attach(video())
      renderer.setState('speaking')
      renderer.pushAudio(1, new Int16Array(480))
      renderer.interrupt()
      renderer.setState('listening')
      renderer.dispose()
      expect(renderer.videoLagMs).toBeGreaterThanOrEqual(0)
    })

    it('tolerates audio arriving before attach and after dispose', () => {
      const renderer = make()
      expect(() => renderer.pushAudio(1, new Int16Array(240))).not.toThrow()
      renderer.dispose()
      expect(() => renderer.pushAudio(2, new Int16Array(240))).not.toThrow()
    })
  })
}

contract('NoneRenderer', () => new NoneRenderer())
contract('FakeRenderer', () => new FakeRenderer())

describe('renderer failure', () => {
  it('surfaces attach failure so the call can fall back to no avatar', async () => {
    const renderer = new FakeRenderer()
    renderer.failAttach = true
    const fallback = vi.fn(() => new NoneRenderer())

    const active = await renderer.attach(video()).then(
      () => renderer as AvatarRenderer,
      () => fallback(),
    )

    expect(fallback).toHaveBeenCalledOnce()
    expect(active).toBeInstanceOf(NoneRenderer)
  })

  it('drops queued audio when the candidate barges in', async () => {
    const renderer = new FakeRenderer()
    await renderer.attach(video())
    renderer.pushAudio(1, new Int16Array(480))
    renderer.pushAudio(1, new Int16Array(480))
    renderer.interrupt()
    expect(renderer.chunks).toEqual([])
    expect(renderer.interrupts).toBe(1)
  })
})

export { FakeRenderer }
