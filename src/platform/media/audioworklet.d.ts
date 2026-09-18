// Globals of the AudioWorkletGlobalScope, used only by *.worklet.ts files.
declare class AudioWorkletProcessor {
  readonly port: MessagePort
  constructor(options?: unknown)
}

declare function registerProcessor(
  name: string,
  processorCtor: new (options?: unknown) => AudioWorkletProcessor & {
    process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean
  },
): void

declare const sampleRate: number
declare const currentTime: number
