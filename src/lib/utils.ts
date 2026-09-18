import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))

/** Deterministic 0..1 pseudo-random. Keeps procedural geometry stable across
 *  re-renders, which matters because a reshuffled city looks like a bug. */
export const rand = (seed: number) => {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

export const randRange = (seed: number, min: number, max: number) =>
  min + rand(seed) * (max - min)

export const pick = <T>(seed: number, items: readonly T[]): T =>
  items[Math.floor(rand(seed) * items.length) % items.length]

/** Ease used for every scripted camera move. Slow-in, fast-middle, soft-out. */
export const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2

export const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t)
