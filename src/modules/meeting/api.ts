import type { MeetingBriefing, MeetingRole } from '@/data/practice'
import { api } from '@/platform/api/client'

/**
 * Meeting sessions (`backend/app/modules/meeting`): a work meeting on the user's own topic, in the
 * role they choose, with one person or a group, online or in person. The others are played live on
 * `/sessions/{id}/live`.
 */

/** The largest file read into the meeting (the server's limit too). */
export const MAX_MATERIAL_BYTES = 8 * 1024 * 1024

const base64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1] ?? '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })

export const createMeetingSession = async (body: {
  role: MeetingRole
  topic: string
  group: boolean
  mode: 'online' | 'in-person'
  durationMinutes: number
  /** A brief, deck or report the meeting is built on: read on the server, never stored. */
  material?: File
}) => {
  const { material, ...rest } = body
  return api<{
    id: string
    maxDurationMs: number
    people: { key: string; name: string; role: string }[]
    briefing: MeetingBriefing
    materialRead: boolean
  }>('/meeting/sessions', {
    method: 'POST',
    body: {
      id: crypto.randomUUID(),
      ...rest,
      material: material ? { name: material.name, data: await base64(material) } : undefined,
    },
    // Writing the meeting from the topic and material can wait out a busy model: longer than usual.
    timeoutMs: 90_000,
  })
}
