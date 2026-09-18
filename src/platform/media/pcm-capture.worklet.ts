import { BoxDownsampler, toInt16 } from './downsample'

const TARGET_RATE = 16_000
const CHUNK_SAMPLES = 1_600 // 100 ms

/**
 * Runs on the audio thread: downsamples the microphone to 16 kHz PCM16 and
 * posts 100 ms chunks with the AudioContext time of each chunk's first sample,
 * so the main thread can stamp frames on the shared media clock.
 */
class PcmCaptureProcessor extends AudioWorkletProcessor {
  private readonly downsampler = new BoxDownsampler(sampleRate / TARGET_RATE)
  private chunk = new Int16Array(CHUNK_SAMPLES)
  private filled = 0
  private chunkStart = 0

  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0]
    if (!channel) return true
    const blockStart = currentTime
    this.downsampler.push(channel, (sample, inputIndex) => {
      if (this.filled === 0) this.chunkStart = blockStart + inputIndex / sampleRate
      this.chunk[this.filled++] = toInt16(sample)
      if (this.filled === CHUNK_SAMPLES) {
        const full = this.chunk
        this.port.postMessage({ pcm: full, startTime: this.chunkStart }, [full.buffer])
        this.chunk = new Int16Array(CHUNK_SAMPLES)
        this.filled = 0
      }
    })
    return true
  }
}

registerProcessor('pcm-capture', PcmCaptureProcessor)
