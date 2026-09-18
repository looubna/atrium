import { useEffect, useState } from 'react'

/** The user's own camera, only while they have switched it on. */
export function useCamera(on: boolean) {
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!on) return
    let cancelled = false
    let active: MediaStream | null = null
    setError(null)
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Camera needs a secure (https) page')
      return
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop())
          return
        }
        active = s
        setStream(s)
      })
      .catch((e: DOMException) => setError(e.name === 'NotAllowedError' ? 'Camera blocked' : 'No camera found'))
    return () => {
      cancelled = true
      active?.getTracks().forEach((t) => t.stop())
      setStream(null)
    }
  }, [on])

  return { stream, error }
}
