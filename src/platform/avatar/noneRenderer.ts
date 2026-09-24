import type { AvatarRenderer, AvatarState } from './types'

/**
 * No face: the call falls back to today's static interviewer tile.
 *
 * This is the default, and also where a live session lands if a provider fails
 * mid-interview — the interview itself never depends on the avatar.
 */
export class NoneRenderer implements AvatarRenderer {
  readonly providesAudio = false
  readonly videoLagMs = 0

  async attach(): Promise<void> {}
  pushAudio(_turnSeq: number, _pcm: Int16Array): void {}
  interrupt(): void {}
  setState(_state: AvatarState): void {}
  dispose(): void {}
}

export const noneRenderer = (): AvatarRenderer => new NoneRenderer()
