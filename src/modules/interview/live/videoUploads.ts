import { create } from 'zustand'
import type { VideoRecording } from '@/platform/media/cameraRecorder'
import { uploadResumable } from '@/platform/upload/resumableUpload'
import { completeVideoUpload, createVideoUpload, resolveMediaUrl } from '../api'

export type VideoUploadStatus = 'uploading' | 'done' | 'failed'

export interface VideoUpload {
  status: VideoUploadStatus
  /** 0..1 */
  progress: number
}

/** Upload progress per session, readable from any screen. */
export const useVideoUploads = create<{ bySession: Record<string, VideoUpload> }>(() => ({ bySession: {} }))

const update = (sessionId: string, upload: VideoUpload) =>
  useVideoUploads.setState((state) => ({ bySession: { ...state.bySession, [sessionId]: upload } }))

/**
 * Uploads a session's camera recording. Runs outside components, so leaving
 * the call screen doesn't cancel it. One video per session.
 */
export async function uploadSessionVideo(sessionId: string, recording: VideoRecording): Promise<void> {
  if (useVideoUploads.getState().bySession[sessionId]) return
  update(sessionId, { status: 'uploading', progress: 0 })
  try {
    const { uploadId, uploadUrl, chunkBytes } = await createVideoUpload(sessionId, {
      contentType: recording.contentType,
      sizeBytes: recording.blob.size,
      startedAtMediaMs: Math.round(recording.startedAtMediaMs),
    })
    await uploadResumable(resolveMediaUrl(uploadUrl), recording.blob, recording.contentType, {
      chunkBytes,
      onProgress: (sent, total) => update(sessionId, { status: 'uploading', progress: sent / total }),
    })
    await completeVideoUpload(sessionId, uploadId)
    update(sessionId, { status: 'done', progress: 1 })
  } catch {
    update(sessionId, { status: 'failed', progress: 0 })
  }
}
