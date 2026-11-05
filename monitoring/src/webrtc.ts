import { apiUrl } from './api'
import { z } from 'zod'

const configuration = z.object({
  iceServers: z.array(z.object({
    urls: z.union([z.string(), z.array(z.string())]),
    username: z.string().optional(),
    credential: z.string().optional(),
  })),
  iceTransportPolicy: z.enum(['all', 'relay']).default('all'),
})

export const DEFAULT_DRONE_ID: string = import.meta.env.VITE_DEFAULT_DRONE_ID ?? 'drone-001'

export async function loadRtcConfiguration(): Promise<RTCConfiguration> {
  const response = await fetch('/webrtc-config.json', { cache: 'no-store' })
  if (response.status === 404) return { iceServers: [] }
  if (!response.ok) throw new Error(`WebRTC configuration ${response.status}`)
  return configuration.parse(await response.json())
}

const inboundVideo = z.object({
  type: z.literal('inbound-rtp'),
  kind: z.literal('video'),
  framesDecoded: z.number(),
})

export function watchVideoFrames(
  peer: RTCPeerConnection,
  onState: (state: 'playing' | 'stalled' | 'failed') => void,
): () => void {
  let disposed = false
  let polling = false
  let previousFrames = 0
  let lastFrameAt = performance.now()
  const timer = window.setInterval(() => {
    if (disposed || polling || peer.connectionState === 'closed') return
    polling = true
    void peer.getStats().then((stats) => {
      if (disposed) return
      let decoded = 0
      for (const entry of stats.values()) {
        const parsed = inboundVideo.safeParse(entry)
        if (parsed.success) decoded += parsed.data.framesDecoded
      }
      if (decoded > previousFrames) {
        previousFrames = decoded
        lastFrameAt = performance.now()
        onState('playing')
      } else if (performance.now() - lastFrameAt > 8000) {
        onState('stalled')
      }
    }).catch(() => {
      if (!disposed) onState('failed')
    }).finally(() => {
      polling = false
    })
  }, 1000)
  return () => {
    disposed = true
    window.clearInterval(timer)
  }
}


const streamInfo = z.object({ publish_url: z.string().startsWith('srt://') })

export async function loadSrtPublishUrl(droneId: string, signal: AbortSignal): Promise<string> {
  const response = await fetch(apiUrl(`/api/v1/streams/${encodeURIComponent(droneId)}`), { signal })
  if (!response.ok) throw new Error(`Stream configuration ${response.status}`)
  return streamInfo.parse(await response.json()).publish_url
}
