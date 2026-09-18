import { useEffect, useRef } from 'react'
import { saveFaceMetrics } from '@/modules/interview/api'
import { CameraRecorder, cameraRecordingSupported } from '@/platform/media/cameraRecorder'
import { FaceTracker, type FaceTrackerOptions } from '@/platform/media/faceMetrics'
import { useLiveInterview } from './useLiveInterview'
import { uploadSessionVideo, useVideoUploads } from './videoUploads'

/**
 * Everything a live interview needs, wherever it happens (a video call or the meeting room):
 * the conversation, the camera recording and the on-device face measurements.
 *
 * The interviewer has no face: interviews are voice only, and the person is shown as a name
 * card. The measurements here are of the *candidate*, from their own camera, and feed their
 * feedback — nothing about them leaves the device but the per-second numbers.
 */
export function useInterviewRoom({
  sessionId,
  camera,
  beforeConnect,
  tracker,
}: {
  /** The live session, or null when no interview runs here. */
  sessionId: string | null
  /** The candidate's camera, when on: recorded for feedback and measured on the device. */
  camera: MediaStream | null
  /** Resolves when the interviewer may start talking. */
  beforeConnect?: () => Promise<void>
  tracker?: FaceTrackerOptions
}) {
  const live = useLiveInterview(sessionId, beforeConnect)
  const liveActive = ['connecting', 'live', 'reconnecting'].includes(live.state.phase)
  const videoUpload = useVideoUploads((s) => (sessionId ? s.bySession[sessionId] : undefined))

  // Camera video for the feedback player: one clip per interview, from when the camera is on
  // during the conversation until it is turned off, the interview ends or the candidate leaves.
  const joined = live.state.phase === 'live' || live.state.phase === 'reconnecting'
  const recordedSessionRef = useRef<string | null>(null)
  const liveMediaMs = live.mediaMs
  useEffect(() => {
    const track = camera?.getVideoTracks()[0]
    if (!sessionId || !joined || !track || recordedSessionRef.current === sessionId) return
    if (!cameraRecordingSupported()) return
    let recorder: CameraRecorder
    try {
      recorder = new CameraRecorder(track, liveMediaMs())
    } catch {
      return
    }
    recordedSessionRef.current = sessionId
    const id = sessionId
    return () => {
      void recorder.stop().then((recording) => {
        if (recording) void uploadSessionVideo(id, recording)
      })
    }
  }, [camera, joined, sessionId, liveMediaMs])

  // Eye contact, smiling and head movement, measured on the device while the camera is on.
  // Frames never leave the device; only per-second numbers are saved for feedback.
  const trackedSessionRef = useRef<string | null>(null)
  const trackerRef = useRef(tracker)
  trackerRef.current = tracker
  useEffect(() => {
    if (!sessionId || !joined || !camera || trackedSessionRef.current === sessionId) return
    trackedSessionRef.current = sessionId
    const id = sessionId
    const options = trackerRef.current
    const faces = new FaceTracker(camera, liveMediaMs, {
      setting: options?.setting,
      // Read through the ref: who is speaking changes all interview long.
      speakerSeat: options?.speakerSeat && (() => trackerRef.current?.speakerSeat?.() ?? null),
    })
    void faces.start()
    return () => {
      const seconds = faces.stop()
      if (seconds.length >= 20) void saveFaceMetrics(id, seconds).catch(() => {})
    }
  }, [camera, joined, sessionId, liveMediaMs])

  return { live, liveActive, videoUpload }
}

export type InterviewRoom = ReturnType<typeof useInterviewRoom>
