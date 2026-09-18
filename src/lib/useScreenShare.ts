import { useCallback, useEffect, useRef, useState } from 'react'

export type ShareMode = 'off' | 'screen' | 'slides'

/**
 * Real screen sharing through the browser's own picker. Phones and tablets have
 * no screen capture in the browser: there the presenter's slides are shown
 * instead, with a note saying why.
 */
export function useScreenShare(active: boolean) {
  const [mode, setMode] = useState<ShareMode>('off')
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    setStream(null)
    setMode('off')
    setNotice(null)
  }, [])

  const start = useCallback(async () => {
    setNotice(null)
    const touch = window.matchMedia('(pointer: coarse)').matches
    if (!navigator.mediaDevices?.getDisplayMedia) {
      if (touch) {
        // Phones and tablets: present the slides instead.
        setMode('slides')
        setNotice("This device can't share its screen from the browser, so your slides are shown instead.")
      } else {
        setNotice("This browser can't share your screen. Open the app in Chrome, Edge, Firefox or Safari.")
      }
      return
    }
    const asked = performance.now()
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false })
      streamRef.current = s
      // The browser's own "Stop sharing" bar ends the track: follow it.
      s.getVideoTracks()[0]?.addEventListener('ended', stop)
      setStream(s)
      setMode('screen')
    } catch (e) {
      const name = (e as DOMException).name
      // Closing the picker takes a person a moment; a refusal that comes back at
      // once is the browser or the page embedding the app blocking capture.
      const instant = performance.now() - asked < 400
      if (name === 'NotAllowedError' && !instant) return
      setNotice(
        name === 'NotAllowedError' || name === 'SecurityError'
          ? window.self !== window.top
            ? 'Screen sharing is blocked in this embedded preview. Open the app in Chrome or Safari to share your screen.'
            : "Screen sharing is blocked. Allow screen recording for your browser (on a Mac: System Settings → Privacy & Security → Screen Recording), then try again."
          : "Screen sharing didn't start. Try again, or pick a single browser tab.",
      )
    }
  }, [stop])

  // Leaving the call or the room ends any share.
  useEffect(() => {
    if (!active) stop()
  }, [active, stop])
  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), [])

  return { mode, stream, notice, start, stop }
}
