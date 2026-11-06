import { useEffect, useId, useRef, useState } from 'react'
import ky, { HTTPError } from 'ky'
import { z } from 'zod'
import { apiUrl } from './api'
import { ProductPhotoError, readPhotoFile } from './productPhotos'
import { productPhotoStore, useProductPhotos } from './useProductPhotos'
import './ProductPhotoManager.css'

const http = ky.create({ timeout: 8000, retry: 0, credentials: 'same-origin', cache: 'no-store' })
const inventorySchema = z.array(z.object({ id: z.uuid(), name: z.string(), active: z.boolean() }))
type PhotoItem = z.infer<typeof inventorySchema>[number]
type Props = { readonly onSessionExpired: () => void }

export function ProductPhotoManager({ onSessionExpired }: Props) {
  const [items, setItems] = useState<PhotoItem[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [reload, setReload] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    const url = new URL(apiUrl('/api/v1/inventory?limit=500'), location.origin).href
    void http.get(url, { signal: controller.signal }).json().then(raw => {
      const list = inventorySchema.parse(raw)
      if (controller.signal.aborted) return
      setItems(list)
      setSelectedId(current => list.some(item => item.id === current) ? current : list[0]?.id ?? '')
      setError(null)
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return
      if (cause instanceof HTTPError && cause.response.status === 401) onSessionExpired()
      setError(cause instanceof Error ? '상품 목록을 불러오지 못했습니다. 다시 시도해 주세요.' : '상품 목록 조회 오류')
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [reload, onSessionExpired])
  const selected = items.find(item => item.id === selectedId)
  return (
    <section className="panel product-photo-manager" aria-labelledby="product-photo-heading">
      <div className="panel-head">
        <h2 id="product-photo-heading">상품 사진 관리</h2>
        <button type="button" className="button button-secondary" disabled={loading} onClick={() => setReload(value => value + 1)}>상품 목록 갱신</button>
      </div>
      <p className="muted">상품을 먼저 등록한 뒤 선택해 사진을 저장하세요. 저장한 사진은 고객 화면에 자동으로 반영됩니다.</p>
      {loading && <p role="status">상품을 불러오는 중…</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {!loading && !error && items.length === 0 && <p className="muted">사진을 등록할 상품이 없습니다. 위에서 상품을 추가해 주세요.</p>}
      {items.length > 0 && <>
        <label className="field">
          <span>사진을 등록할 상품</span>
          <select value={selectedId} onChange={event => setSelectedId(event.target.value)}>
            {items.map(item => <option key={item.id} value={item.id}>{item.name}{item.active ? '' : ' (판매 중지)'}</option>)}
          </select>
        </label>
        {selected && <ProductPhotoEditor key={selected.id} item={selected} onSessionExpired={onSessionExpired} />}
      </>}
    </section>
  )
}

function ProductPhotoEditor({ item, onSessionExpired }: Props & { readonly item: PhotoItem }) {
  const photos = useProductPhotos()
  const inputId = useId()
  const reading = useRef(0)
  const [preview, setPreview] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [readingFile, setReadingFile] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  useEffect(() => () => { reading.current++ }, [])
  async function choose(file: File | undefined) {
    const request = ++reading.current
    setPreview(null); setNotice(null); setError(null)
    if (!file) { setReadingFile(false); return }
    setReadingFile(true)
    try {
      const dataUrl = await readPhotoFile(file)
      if (reading.current === request) setPreview(dataUrl)
    } catch (cause) {
      if (reading.current === request) setError(cause instanceof Error ? cause.message : '사진을 읽지 못했습니다.')
    } finally { if (reading.current === request) setReadingFile(false) }
  }
  async function save() {
    if (!preview || saving) return
    setSaving(true); setError(null); setNotice(null)
    try {
      await productPhotoStore.upload(item.id, preview)
      setPreview(null)
      setNotice('사진을 저장했습니다. 고객 화면에 자동으로 반영됩니다.')
    } catch (cause) {
      if (cause instanceof ProductPhotoError && cause.status === 401) onSessionExpired()
      setError(cause instanceof Error ? cause.message : '사진 저장에 실패했습니다.')
    } finally { setSaving(false) }
  }
  const src = preview ?? photos[item.id]?.src
  return (
    <div className="product-photo-editor">
      {src ? <img src={src} width="160" height="160" alt={`${item.name} ${preview ? '저장 전 미리보기' : '현재 사진'}`} /> : <p className="muted">등록된 상품 사진이 없습니다.</p>}
      <label className="field" htmlFor={inputId}>
        <span>사진 선택 (JPG·PNG·WebP, 최대 1MB)</span>
        <input id={inputId} type="file" accept="image/jpeg,image/png,image/webp" disabled={saving} onChange={event => { void choose(event.target.files?.[0]); event.target.value = '' }} />
      </label>
      {readingFile && <p role="status">미리보기를 준비하는 중…</p>}
      {preview && <p className="muted">미리보기입니다. 사진 저장을 눌러 적용하세요.</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <button className="button" type="button" disabled={!preview || readingFile || saving} onClick={() => void save()}>{saving ? '저장 중…' : '사진 저장'}</button>
    </div>
  )
}
