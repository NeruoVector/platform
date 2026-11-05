import { DEFAULT_DRONE_ID, loadRtcConfiguration, watchVideoFrames, loadSrtPublishUrl } from './webrtc'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { AdminAuthGate } from './AdminAuthGate'
import { API_BASE_URL, apiUrl } from './api'
import { StorePage } from './StorePage'
import './App.css'

type Detection = {
  id: string
  drone_id: string
  label: string
  confidence: number
  latitude: number | null
  longitude: number | null
  distance_m: number | null
  priority_level: number
  detected_at: string
  created_at: string
}

type DroneStatus = {
  drone_id: string
  online: boolean
  last_seen: string
  stale_for_seconds: number
  latitude: number | null
  longitude: number | null
  altitude_m: number | null
  speed_mps: number | null
  battery_pct: number | null
  heading_deg: number | null
  status: string | null
  flight_id: string | null
  flight_status: string | null
  delivery_id: string | null
}

type Recording = {
  drone_id: string
  name: string
  size_bytes: number
  modified_at: string | null
  download_url: string
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; detections: Detection[] }

const CampusMap = lazy(() => import('./CampusMap').then((module) => ({ default: module.CampusMap })))

type View = 'dashboard' | 'map' | 'store' | 'admin'

function viewFromHash(): View {
  const hash = window.location.hash.replace('#', '')
  if (hash === 'map' || hash === 'store' || hash === 'admin') return hash
  return 'dashboard'
}

function formatTime(value: string | null) {
  return value ? new Date(value).toLocaleString('ko-KR') : '—'
}

function priorityLabel(level: number) {
  if (level === 1) return '1단계 · 위험'
  if (level === 3) return '3단계 · 낮음'
  return '2단계 · 주의'
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function App() {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [view, setView] = useState<View>(() => viewFromHash())

  useEffect(() => {
    const syncView = () => setView(viewFromHash())
    window.addEventListener('hashchange', syncView)
    return () => window.removeEventListener('hashchange', syncView)
  }, [])

  function navigate(next: View) {
    window.location.hash = next
  }

  useEffect(() => {
    const controller = new AbortController()

    async function load() {
      try {
        const response = await fetch(apiUrl('/api/v1/detections?limit=50'), {
          signal: controller.signal,
        })
        if (!response.ok) {
          throw new Error(`API ${response.status}`)
        }
        const detections = (await response.json()) as Detection[]
        setState({ status: 'ready', detections })
      } catch (error) {
        if (controller.signal.aborted) return
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : '알 수 없는 오류',
        })
      }
    }

    load()
    return () => controller.abort()
  }, [])

  return (
    <main className="app">
      <header className="header">
        <div className="header-row">
          <div>
            <h1>NeuroVector</h1>
            <p className="subtitle">드론 장애물 감지 · 실시간 영상 · 배송 모니터</p>
          </div>
          <nav className="nav" aria-label="주요 화면">
            <button
              type="button"
              className={view === 'dashboard' ? 'nav-item active' : 'nav-item'}
              onClick={() => navigate('dashboard')}
            >
              모니터링
            </button>
            <button
              type="button"
              className={view === 'map' ? 'nav-item active' : 'nav-item'}
              aria-current={view === 'map' ? 'page' : undefined}
              onClick={() => navigate('map')}
            >
              전체 지도
            </button>
            <button
              type="button"
              className={view === 'store' ? 'nav-item active' : 'nav-item'}
              onClick={() => navigate('store')}
            >
              스토어
            </button>
            <button
              type="button"
              className={view === 'admin' ? 'nav-item active' : 'nav-item'}
              onClick={() => navigate('admin')}
            >
              관리자
            </button>
          </nav>
        </div>
      </header>

      {view === 'dashboard' && (
        <div className="grid">
          <section className="panel">
            <h2>최근 감지</h2>

            {state.status === 'loading' && <p className="muted">불러오는 중…</p>}

            {state.status === 'error' && (
              <p className="error">
                데이터를 불러오지 못했습니다: {state.message}
                <br />
                <span className="muted">
                  백엔드({API_BASE_URL || 'same-origin'})가 실행 중인지 확인하세요.
                </span>
              </p>
            )}

            {state.status === 'ready' && state.detections.length === 0 && (
              <p className="muted">아직 감지 기록이 없습니다.</p>
            )}

            {state.status === 'ready' && state.detections.length > 0 && (
              <div className="scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th>시각</th>
                      <th>드론</th>
                      <th>객체</th>
                      <th>신뢰도</th>
                      <th>거리</th>
                      <th>단계</th>
                      <th>위치</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.detections.map((d) => {
                      const priority = d.priority_level ?? 2
                      return (
                        <tr key={d.id}>
                          <td>{formatTime(d.detected_at)}</td>
                          <td>{d.drone_id}</td>
                          <td>{d.label}</td>
                          <td>{(d.confidence * 100).toFixed(1)}%</td>
                          <td>{d.distance_m != null ? `${d.distance_m.toFixed(1)} m` : '—'}</td>
                          <td>
                            <span className={`badge priority-${priority}`}>
                              {priorityLabel(priority)}
                            </span>
                          </td>
                          <td>
                            {d.latitude != null && d.longitude != null
                              ? `${d.latitude.toFixed(5)}, ${d.longitude.toFixed(5)}`
                              : '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <DroneStatusPanel />

          <CameraPanel />

          <RecordingsPanel />
        </div>
      )}

      {view === 'map' && (
        <Suspense fallback={<p className="muted" role="status">지도를 준비하는 중…</p>}>
          <CampusMap />
        </Suspense>
      )}
      {view === 'store' && <StorePage onOpenAdmin={() => navigate('admin')} />}
      {view === 'admin' && (
        <AdminAuthGate onOpenStore={() => navigate('store')} />
      )}
    </main>
  )
}

function DroneStatusPanel() {
  const [statuses, setStatuses] = useState<DroneStatus[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    async function load() {
      try {
        const response = await fetch(apiUrl('/api/v1/flights/status'), {
          signal: controller.signal,
        })
        if (!response.ok) throw new Error(`API ${response.status}`)
        setStatuses((await response.json()) as DroneStatus[])
        setError(null)
      } catch (err) {
        if (controller.signal.aborted) return
        setError(err instanceof Error ? err.message : '상태를 불러오지 못했습니다.')
      }
    }

    load()
    const timer = window.setInterval(load, 5000)
    return () => {
      controller.abort()
      window.clearInterval(timer)
    }
  }, [])

  return (
    <section className="panel">
      <h2>드론 상태</h2>
      {error && <p className="error">상태 조회 실패: {error}</p>}
      {!error && statuses.length === 0 && (
        <p className="muted">아직 텔레메트리가 없습니다. MQTT telemetry 토픽을 확인하세요.</p>
      )}
      {statuses.length > 0 && (
        <div className="scroll">
          <table className="table">
            <thead>
              <tr>
                <th>드론</th>
                <th>상태</th>
                <th>배터리</th>
                <th>고도</th>
                <th>속도</th>
                <th>최근 수신</th>
              </tr>
            </thead>
            <tbody>
              {statuses.map((item) => (
                <tr key={item.drone_id}>
                  <td>{item.drone_id}</td>
                  <td>
                    <span className={item.online ? 'badge badge-online' : 'badge badge-offline'}>
                      {item.online ? 'online' : 'offline'}
                    </span>
                  </td>
                  <td>{item.battery_pct != null ? `${item.battery_pct.toFixed(1)}%` : '—'}</td>
                  <td>{item.altitude_m != null ? `${item.altitude_m.toFixed(1)} m` : '—'}</td>
                  <td>{item.speed_mps != null ? `${item.speed_mps.toFixed(1)} m/s` : '—'}</td>
                  <td>{formatTime(item.last_seen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function CameraPanel() {
  const [droneId, setDroneId] = useState(DEFAULT_DRONE_ID)
  const [publishUrl, setPublishUrl] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const peerRef = useRef<RTCPeerConnection | null>(null)
  const stopFrameWatchRef = useRef<(() => void) | null>(null)
  const sessionUrlRef = useRef<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    void loadSrtPublishUrl(droneId, controller.signal).then(setPublishUrl).catch(() => {
      if (!controller.signal.aborted) setPublishUrl(null)
    })
    return () => controller.abort()
  }, [droneId])

  function disconnect() {
    stopFrameWatchRef.current?.()
    stopFrameWatchRef.current = null
    const peer = peerRef.current
    if (peer) {
      peer.ontrack = null
      peer.onconnectionstatechange = null
      peer.close()
    }
    if (videoRef.current) {
      videoRef.current.onloadeddata = null
      videoRef.current.srcObject = null
    }
    const sessionUrl = sessionUrlRef.current
    sessionUrlRef.current = null
    if (sessionUrl) {
      void fetch(sessionUrl, { method: 'DELETE' }).catch(() => undefined)
    }
    peerRef.current = null
    setConnecting(false)
  }

  useEffect(() => {
    return () => {
      stopFrameWatchRef.current?.()
      peerRef.current?.close()
      const sessionUrl = sessionUrlRef.current
      if (sessionUrl) {
        void fetch(sessionUrl, { method: 'DELETE' }).catch(() => undefined)
      }
    }
  }, [])

  async function connect() {
    disconnect()
    setMessage(null)
    setConnecting(true)

    try {
      const peer = new RTCPeerConnection(await loadRtcConfiguration())
      peerRef.current = peer
      peer.addTransceiver('video', { direction: 'recvonly' })
      peer.addTransceiver('audio', { direction: 'recvonly' })
      peer.ontrack = (event) => {
        if (videoRef.current) {
          videoRef.current.onloadeddata = () => setMessage('영상 수신 중')
          videoRef.current.srcObject = event.streams[0]
        }
      }
      peer.onconnectionstatechange = () => {
        if (peer.connectionState === 'failed') {
          setMessage('WebRTC 연결이 끊어졌습니다. SRT 송출 상태를 확인하세요.')
        }
      }

      const offer = await peer.createOffer()
      await peer.setLocalDescription(offer)
      await waitForIceGathering(peer)

      const response = await fetch(
        apiUrl(`/api/v1/streams/${encodeURIComponent(droneId)}/whep`),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/sdp' },
          body: peer.localDescription?.sdp ?? '',
        },
      )

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(errorText || `WHEP ${response.status}`)
      }

      const answer = await response.text()
      const location = response.headers.get('Location')
      const sessionId = location?.split('?')[0].split('/').filter(Boolean).at(-1)
      sessionUrlRef.current = sessionId
        ? apiUrl(`/api/v1/streams/${encodeURIComponent(droneId)}/whep/${sessionId}`)
        : null

      await peer.setRemoteDescription({ type: 'answer', sdp: answer })
      stopFrameWatchRef.current = watchVideoFrames(peer, (state) => {
        switch (state) {
          case 'playing': setMessage('영상 수신 중'); break
          case 'stalled': setMessage('영상 프레임 수신이 중단됐습니다. 다시 연결해 주세요.'); break
          case 'failed': setMessage('영상 전송 상태를 확인할 수 없습니다. 다시 연결해 주세요.'); break
          default: { const unreachable: never = state; return unreachable }
        }
      })
      if (!videoRef.current || videoRef.current.readyState < 2) {
        setMessage('영상 수신 대기 중…')
      }
    } catch (error) {
      disconnect()
      setMessage(
        error instanceof Error
          ? `영상 연결 실패: ${error.message}`
          : '영상 연결에 실패했습니다.',
      )
    } finally {
      setConnecting(false)
    }
  }

  return (
    <section id="camera" className="panel">
      <h2>실시간 카메라</h2>
      <div className="controls">
        <label className="field">
          <span>드론 ID</span>
          <input
            value={droneId}
            onChange={(event) => { setDroneId(event.target.value); setPublishUrl(null) }}
            placeholder="drone-001"
          />
        </label>
        <button className="button" onClick={() => void connect()} disabled={connecting}>
          {connecting ? '연결 중…' : '영상 연결'}
        </button>
        <button className="button button-secondary" onClick={disconnect}>
          연결 해제
        </button>
      </div>

      <div className="video-wrap">
        <video ref={videoRef} autoPlay playsInline muted />
      </div>
      {message && <p className={message === '영상 수신 중' || message === '영상 수신 대기 중…' ? 'muted' : 'error'}>{message}</p>}
      <p className="muted small">
        SRT 송출 주소: <code>{publishUrl ?? '송출 주소를 조회할 수 없습니다.'}</code>
      </p>
    </section>
  )
}

function RecordingsPanel() {
  const [input, setInput] = useState(DEFAULT_DRONE_ID)
  const [droneId, setDroneId] = useState(DEFAULT_DRONE_ID)
  const [items, setItems] = useState<Recording[]>([])
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const controller = new AbortController()

    async function load() {
      setLoading(true)
      try {
        const response = await fetch(
          apiUrl(`/api/v1/recordings?drone_id=${encodeURIComponent(droneId)}`),
          { signal: controller.signal },
        )
        if (!response.ok) throw new Error(`API ${response.status}`)
        setItems((await response.json()) as Recording[])
        setError(null)
      } catch (err) {
        if (controller.signal.aborted) return
        setError(err instanceof Error ? err.message : '녹화 목록을 불러오지 못했습니다.')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    load()
    return () => controller.abort()
  }, [droneId, reloadKey])

  return (
    <section className="panel">
      <h2>녹화 파일</h2>
      <form
        className="controls"
        onSubmit={(event) => {
          event.preventDefault()
          setDroneId(input.trim() || 'drone-001')
          setReloadKey((key) => key + 1)
        }}
      >
        <label className="field">
          <span>드론 ID</span>
          <input value={input} onChange={(event) => setInput(event.target.value)} />
        </label>
        <button className="button" type="submit">
          새로고침
        </button>
      </form>

      {loading && <p className="muted">불러오는 중…</p>}
      {error && <p className="error">녹화 조회 실패: {error}</p>}
      {!loading && !error && items.length === 0 && (
        <p className="muted">녹화 파일이 없습니다.</p>
      )}
      {items.length > 0 && (
        <ul className="recordings">
          {items.map((item) => {
            const href = item.download_url.startsWith('http')
              ? item.download_url
              : apiUrl(item.download_url)
            return (
              <li key={`${item.drone_id}-${item.name}`}>
                <a href={href} download>
                  {item.name}
                </a>
                <span className="muted">
                  {formatBytes(item.size_bytes)} · {formatTime(item.modified_at)}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function waitForIceGathering(peer: RTCPeerConnection) {
  if (peer.iceGatheringState === 'complete') return Promise.resolve()

  return new Promise<void>((resolve) => {
    const timeout = window.setTimeout(finish, 3000)

    function finish() {
      window.clearTimeout(timeout)
      peer.removeEventListener('icegatheringstatechange', check)
      resolve()
    }

    function check() {
      if (peer.iceGatheringState === 'complete') finish()
    }

    peer.addEventListener('icegatheringstatechange', check)
  })
}

export default App
