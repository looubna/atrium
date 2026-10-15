import { useEffect, useState } from 'react'

/** "9:05" */
export const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

/**
 * A session countdown that the user starts, pauses and restarts. Resets
 * whenever the total changes, so switching sessions never carries time over.
 */
export function useCountdown(totalSeconds: number) {
  const [left, setLeft] = useState(totalSeconds)
  const [running, setRunning] = useState(false)

  useEffect(() => {
    setLeft(totalSeconds)
    setRunning(false)
  }, [totalSeconds])

  useEffect(() => {
    if (!running) return
    const id = window.setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000)
    return () => window.clearInterval(id)
  }, [running])

  useEffect(() => {
    if (left === 0) setRunning(false)
  }, [left])

  const done = totalSeconds > 0 && left === 0

  const toggle = () => {
    if (done) {
      setLeft(totalSeconds)
      setRunning(true)
      return
    }
    setRunning((r) => !r)
  }

  /** Stops and rewinds: the session never began. Safe from a stale closure (only setters). */
  const stop = () => {
    setRunning(false)
    setLeft(totalSeconds)
  }

  const label = running ? 'Pause' : done ? 'Again' : left < totalSeconds ? 'Resume' : 'Start'
  const progress = totalSeconds > 0 ? left / totalSeconds : 0

  return { left, running, done, toggle, stop, label, progress }
}
