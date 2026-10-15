import { api } from '@/platform/api/client'

/**
 * Where the face video can travel (backend `platform/faces/ice.py`): Google's STUN for the direct
 * route, plus a Cloudflare TURN relay for networks that block WebRTC (office, school, hotel Wi-Fi). The
 * browser tries direct first and falls back to the relay on its own. Asked once and kept for an hour;
 * if the server can't be asked, the direct route alone — exactly as before the relay existed.
 */
const DIRECT: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }]
const KEEP_MS = 60 * 60 * 1000

let cached: { at: number; servers: RTCIceServer[] } | null = null

export async function faceIceServers(): Promise<RTCIceServer[]> {
  if (cached && Date.now() - cached.at < KEEP_MS) return cached.servers
  try {
    const { iceServers } = await api<{ iceServers: RTCIceServer[] }>('/faces/ice')
    const servers = Array.isArray(iceServers) && iceServers.length ? iceServers : DIRECT
    cached = { at: Date.now(), servers }
    return servers
  } catch {
    return DIRECT
  }
}
