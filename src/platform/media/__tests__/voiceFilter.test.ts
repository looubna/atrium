import { describe, expect, it } from 'vitest'
import { SpeakerVoice } from '../voiceFilter'

const tone = (hz: number, seconds = 0.5, rate = 24_000) =>
  Int16Array.from({ length: rate * seconds }, (_, i) => Math.round(20_000 * Math.sin((2 * Math.PI * hz * i) / rate)))

/** Peak of the second half, once the filter has settled. */
const peak = (pcm: Int16Array) => Math.max(...pcm.subarray(pcm.length / 2).map(Math.abs))

describe('SpeakerVoice', () => {
  it('takes out the bass a small speaker rattles on and keeps the voice', () => {
    expect(peak(new SpeakerVoice().process(tone(40)))).toBeLessThan(20_000 * 0.7 * 0.2)
    expect(peak(new SpeakerVoice().process(tone(1_000)))).toBeGreaterThan(20_000 * 0.7 * 0.95)
  })

  it('carries its state across chunks, so a split stream sounds like an unsplit one', () => {
    const whole = new SpeakerVoice().process(tone(300))
    const split = new SpeakerVoice()
    const parts = [split.process(tone(300).subarray(0, 5_000)), split.process(tone(300).subarray(5_000))]
    expect(Int16Array.from([...parts[0], ...parts[1]])).toEqual(whole)
  })
})
