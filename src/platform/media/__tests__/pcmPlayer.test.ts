import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PcmPlayer } from '../pcmPlayer'

/** Just enough Web Audio to record when each buffer was scheduled. */
class FakeSource {
  onended: (() => void) | null = null
  startedAt = -1
  stopped = false
  constructor(
    public buffer: { duration: number } | null,
    private readonly sources: Set<FakeSource>,
  ) {}
  connect(): void {}
  start(at: number): void {
    this.startedAt = at
    this.sources.add(this)
  }
  stop(): void {
    this.stopped = true
    this.sources.delete(this)
  }
  finish(): void {
    this.sources.delete(this)
    this.onended?.()
  }
}

class FakeContext {
  currentTime = 10
  destination = {}
  readonly started: FakeSource[] = []
  private readonly live = new Set<FakeSource>()

  createGain() {
    // Chainable, like the real node: the player wires output → speaker → destination.
    const node = {
      gain: { value: 1 },
      connect: (next?: unknown) => next ?? node,
      disconnect: () => {},
    }
    return node
  }
  private param = () => ({ value: 0 })
  createBiquadFilter() {
    return { ...this.createGain(), type: '', frequency: this.param(), Q: this.param() }
  }
  createDynamicsCompressor() {
    const [threshold, knee, ratio, attack, release] = Array.from({ length: 5 }, this.param)
    return { ...this.createGain(), threshold, knee, ratio, attack, release }
  }
  createBuffer(_channels: number, length: number, rate: number) {
    return { duration: length / rate, copyToChannel: () => {} }
  }
  createBufferSource() {
    const source = new FakeSource(null, this.live)
    const start = source.start.bind(source)
    source.start = (at: number) => {
      start(at)
      this.started.push(source)
    }
    return source
  }
}

const player = (ctx: FakeContext) =>
  new PcmPlayer(ctx as unknown as AudioContext, (t) => t * 1000, {
    onTurnStart: vi.fn(),
    onTurnStop: vi.fn(),
    onSpeakingChange: vi.fn(),
  })

describe('PcmPlayer lead time', () => {
  let ctx: FakeContext

  beforeEach(() => {
    ctx = new FakeContext()
  })

  it('schedules 40 ms ahead by default', () => {
    player(ctx).enqueue(1, new Int16Array(2400))
    expect(ctx.started[0].startedAt).toBeCloseTo(10.04, 5)
  })

  it('waits for the avatar when a lag is set', () => {
    const p = player(ctx)
    p.setLead(180)
    p.enqueue(1, new Int16Array(2400))
    expect(ctx.started[0].startedAt).toBeCloseTo(10.22, 5)
  })

  it('keeps later chunks of a turn gapless behind the delayed first chunk', () => {
    const p = player(ctx)
    p.setLead(180)
    p.enqueue(1, new Int16Array(2400)) // 0.1 s at 24 kHz
    p.enqueue(1, new Int16Array(2400))
    expect(ctx.started[1].startedAt).toBeCloseTo(10.32, 5)
  })

  it('reports the delayed start time to the server, so the media clock stays honest', () => {
    const onTurnStart = vi.fn()
    const p = new PcmPlayer(ctx as unknown as AudioContext, (t) => t * 1000, {
      onTurnStart,
      onTurnStop: vi.fn(),
      onSpeakingChange: vi.fn(),
    })
    p.setLead(180)
    p.enqueue(7, new Int16Array(2400))
    expect(onTurnStart).toHaveBeenCalledWith(7, 10220)
  })

  it('ignores a negative lag', () => {
    const p = player(ctx)
    p.setLead(-500)
    p.enqueue(1, new Int16Array(2400))
    expect(ctx.started[0].startedAt).toBeCloseTo(10.04, 5)
  })
})

describe('PcmPlayer turns', () => {
  it('queues a new turn behind the one still playing and reports each turn separately', () => {
    const ctx = new FakeContext()
    const events = { onTurnStart: vi.fn(), onTurnStop: vi.fn(), onSpeakingChange: vi.fn() }
    const p = new PcmPlayer(ctx as unknown as AudioContext, (t) => t * 1000, events)
    p.enqueue(1, new Int16Array(2400)) // the lead's hand-over line
    const at = p.enqueue(2, new Int16Array(4800)) // a colleague's question
    // After the lead's line ends (10.14 s) and a breath (TURN_GAP_S), never on top of it.
    expect(ctx.started[1].startedAt).toBeCloseTo(10.39, 5)
    expect(at).toBeCloseTo(10.39, 5)
    expect(ctx.started[0].stopped).toBe(false)
    expect(events.onTurnStart).toHaveBeenNthCalledWith(2, 2, expect.closeTo(10390, 3))

    ctx.currentTime = 10.14
    ctx.started[0].finish()
    expect(events.onTurnStop).toHaveBeenCalledWith(1, expect.closeTo(10140, 3))
    expect(p.isSpeaking).toBe(true)

    ctx.currentTime = 10.79
    ctx.started[1].finish()
    expect(events.onTurnStop).toHaveBeenLastCalledWith(2, expect.closeTo(10790, 3))
    expect(p.isSpeaking).toBe(false)
  })

  it('keeps one speaker gapless: the breath is only between speakers', () => {
    const ctx = new FakeContext()
    const p = player(ctx)
    p.enqueue(1, new Int16Array(2400))
    expect(p.enqueue(1, new Int16Array(2400))).toBeCloseTo(10.14, 5)
  })

  it('stops every queued turn on an interruption', () => {
    const ctx = new FakeContext()
    const events = { onTurnStart: vi.fn(), onTurnStop: vi.fn(), onSpeakingChange: vi.fn() }
    const p = new PcmPlayer(ctx as unknown as AudioContext, (t) => t * 1000, events)
    p.enqueue(1, new Int16Array(2400))
    p.enqueue(2, new Int16Array(2400))
    p.flush()
    expect(ctx.started.every((s) => s.stopped)).toBe(true)
    expect(events.onTurnStop.mock.calls.map((c) => c[0])).toEqual([1, 2])
    expect(p.isSpeaking).toBe(false)
  })

  it('routes an always-audible turn past the muted avatar path', () => {
    const ctx = new FakeContext()
    const targets: unknown[][] = []
    const create = ctx.createBufferSource.bind(ctx)
    ctx.createBufferSource = () => {
      const source = create()
      const seen: unknown[] = []
      source.connect = (node?: unknown) => {
        seen.push(node)
      }
      targets.push(seen)
      return source
    }
    const p = player(ctx)
    p.setAudible(false)
    p.enqueue(1, new Int16Array(240))
    p.enqueue(2, new Int16Array(240), 'always')
    p.enqueue(3, new Int16Array(240), 'silent')
    // Both reach the recording; they leave through different speaker paths.
    expect(targets[0][0]).toBe(p.output)
    expect(targets[1][0]).toBe(p.output)
    expect(targets[0][1]).not.toBe(targets[1][1])
    // A colleague whose own face speaks is only recorded.
    expect(targets[2]).toEqual([p.output])
  })
})
