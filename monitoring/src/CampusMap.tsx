import { useEffect, useRef, useState } from 'react'
import { isCampusFresh, loadCampus, loadLiveCampus } from './campusData'
import type { LiveCampus } from './campusData'
import { createCampusScene } from './campusScene'
import type { CampusScene } from './campusScene'
import './CampusMap.css'

type MapLoad =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready' }
  | { readonly kind: 'error'; readonly message: string }

function campusStatus(snapshot: LiveCampus | null, fresh: boolean, error: string | null): string {
  if (error) return '위치 연결을 확인하고 있습니다.'
  if (!snapshot) return '기체 위치를 기다리고 있습니다.'
  if (!fresh) return '위치 신호가 오래됐습니다. 마지막 위치를 표시합니다.'
  if (!snapshot.position_enu) return '수신 중 · 기체 위치를 기다리고 있습니다.'
  return '실시간 위치 수신 중'
}

function mapErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.includes('WebGL')) {
    return '3D 지도를 시작하지 못했습니다. 브라우저의 그래픽 가속을 확인하거나 다른 브라우저에서 다시 시도해 주세요.'
  }
  return '학교 지도를 불러오지 못했습니다. 연결 상태를 확인하고 다시 시도해 주세요.'
}

export function CampusMap() {
  const host = useRef<HTMLDivElement | null>(null)
  const scene = useRef<CampusScene | null>(null)
  const latest = useRef<LiveCampus | null>(null)
  const [load, setLoad] = useState<MapLoad>({ kind: 'loading' })
  const [snapshot, setSnapshot] = useState<LiveCampus | null>(null)
  const [pollError, setPollError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const controller = new AbortController()
    let owned: CampusScene | null = null
    void loadCampus(controller.signal).then(({ fixture, mesh }) => {
      if (controller.signal.aborted || !host.current) return
      owned = createCampusScene(host.current, fixture, mesh)
      scene.current = owned
      if (latest.current) owned.update(latest.current, isCampusFresh(latest.current, Date.now()))
      setLoad({ kind: 'ready' })
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setLoad({ kind: 'error', message: mapErrorMessage(error) })
    })
    return () => {
      controller.abort()
      owned?.dispose()
      if (scene.current === owned) scene.current = null
    }
  }, [revision])

  useEffect(() => {
    const controller = new AbortController()
    let timer = 0
    async function poll() {
      try {
        const next = await loadLiveCampus(controller.signal)
        if (controller.signal.aborted) return
        latest.current = next
        setSnapshot(next)
        setPollError(null)
      } catch (error) {
        if (!controller.signal.aborted) {
          setPollError(error instanceof Error ? error.message : '위치 정보를 읽지 못했습니다.')
        }
      } finally {
        if (!controller.signal.aborted) timer = window.setTimeout(() => void poll(), 1000)
      }
    }
    void poll()
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const fresh = snapshot !== null && isCampusFresh(snapshot, now)
  useEffect(() => {
    if (snapshot) scene.current?.update(snapshot, fresh)
  }, [snapshot, fresh, load.kind])

  const position = snapshot?.position_enu
  const ready = load.kind === 'ready'
  const status = campusStatus(snapshot, fresh, pollError)

  return (
    <section className="campus-map panel" aria-labelledby="campus-title">
      <div className="campus-heading">
        <div>
          <h2 id="campus-title">학교 전체 지도</h2>
          <p className="campus-caption">기체 위치는 1초마다 갱신됩니다.</p>
        </div>
        <a className="campus-link" href="/simulation/" target="_blank" rel="noreferrer">시뮬레이터 화면 열기</a>
      </div>
      <div className="campus-toolbar" aria-label="지도 조작">
        <button className="button" disabled={!ready} onClick={() => scene.current?.reset()}>전체 보기</button>
        <button className="button button-secondary" disabled={!ready} onClick={() => scene.current?.top()}>위에서 보기</button>
        <button className="button button-secondary" disabled={!ready || !position} onClick={() => scene.current?.focus()}>기체 찾기</button>
      </div>
      <div className="campus-stage">
        <div className="campus-canvas" ref={host} />
        {load.kind === 'loading' && <p className="campus-notice" role="status">학교 지도를 불러오는 중…</p>}
        {load.kind === 'error' && (
          <div className="campus-notice" role="alert">
            <p>{load.message}</p>
            <button className="button" onClick={() => { setLoad({ kind: 'loading' }); setRevision((value) => value + 1) }}>다시 불러오기</button>
          </div>
        )}
        {ready && <span className="campus-north" aria-label="북쪽 방향"><span aria-hidden="true">↑</span> N · 북</span>}
      </div>
      <div className="campus-readout">
        <div>
          <p className={fresh && !pollError ? 'campus-status' : 'campus-caption'} role="status">{status}</p>
          <p className="campus-caption">{fresh ? '노란' : '회색'} 표식: {snapshot?.drone_id ?? '기체 대기'}</p>
        </div>
        <dl>
          <div><dt>동쪽 / 북쪽</dt><dd>{position ? `${position[0].toFixed(1)} / ${position[1].toFixed(1)} m` : '—'}</dd></div>
          <div><dt>고도</dt><dd>{position ? `${position[2].toFixed(1)} m` : '—'}</dd></div>
          <div><dt>마지막 수신</dt><dd>{snapshot ? new Date(snapshot.timestamp * 1000).toLocaleTimeString('ko-KR') : '—'}</dd></div>
        </dl>
      </div>
      <p id="campus-map-help" className="campus-caption campus-help">
        <span>드래그: 회전</span>
        <span>휠·두 손가락: 확대·축소</span>
        <span>키보드: 지도 선택 후 방향키·+/−</span>
      </p>
    </section>
  )
}
