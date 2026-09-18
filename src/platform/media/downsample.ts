/**
 * Streaming box-filter downsampler: averages each window of input samples into
 * one output sample. Cheap enough for an audio thread and adequate for speech
 * (the averaging also low-passes before decimation).
 */
export class BoxDownsampler {
  private acc = 0
  private count = 0
  private phase = 0

  constructor(private readonly ratio: number) {
    if (!(ratio >= 1)) throw new RangeError('ratio must be >= 1')
  }

  push(input: Float32Array, emit: (sample: number, inputIndex: number) => void): void {
    for (let i = 0; i < input.length; i++) {
      this.acc += input[i]
      this.count++
      this.phase += 1
      if (this.phase >= this.ratio) {
        emit(this.acc / this.count, i)
        this.acc = 0
        this.count = 0
        this.phase -= this.ratio
      }
    }
  }
}

export const toInt16 = (sample: number): number => Math.round(Math.max(-1, Math.min(1, sample)) * 0x7fff)

export function int16ToFloat32(pcm: Int16Array): Float32Array<ArrayBuffer> {
  const out = new Float32Array(pcm.length)
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] / 0x8000
  return out
}
