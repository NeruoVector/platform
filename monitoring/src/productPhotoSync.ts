import ky, { HTTPError } from 'ky'
import { z } from 'zod'
import {
  PHOTO_CACHE_KEY, PHOTO_CHANNEL, cachedPhotoSchema, photoMetaSchema,
  persistPhotoCache, readPhotoCache, readPhotoFile, ProductPhotoError,
  type PhotoMeta, type PhotoSnapshot, type ProductPhoto,
} from './productPhotos.ts'

const http = ky.create({ timeout: 8000, retry: 0, credentials: 'same-origin', cache: 'no-store' })
const manifestSchema = z.array(photoMetaSchema).max(500)

export class ProductPhotoStore {
  private photos: PhotoSnapshot = readPhotoCache()
  private readonly listeners = new Set<() => void>()
  private channel: BroadcastChannel | undefined
  private controller: AbortController | undefined
  private timer: ReturnType<typeof setInterval> | undefined
  private polling = false
  private readonly downloading = new Set<string>()
  private revision = 0
  private readonly baseUrl: string
  constructor(baseUrl: string) { this.baseUrl = baseUrl }

  getSnapshot = (): PhotoSnapshot => this.photos
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    if (this.listeners.size === 1) this.start()
    return () => { this.listeners.delete(listener); if (this.listeners.size === 0) this.stop() }
  }

  private url(path: string): string {
    return new URL(`${this.baseUrl}${path}`, globalThis.location?.origin ?? 'http://localhost').href
  }
  private photoUrl(photo: PhotoMeta): string {
    return this.url(`/api/v1/inventory/${photo.item_id}/photo?v=${photo.version}`)
  }
  private emit() { for (const listener of this.listeners) listener() }
  private accept(photo: ProductPhoto) {
    if (this.photos[photo.item_id]?.version === photo.version && this.photos[photo.item_id]?.src === photo.src) return
    const next = { ...this.photos }
    delete next[photo.item_id]
    next[photo.item_id] = photo
    this.photos = next
    this.revision++
    persistPhotoCache(next)
    this.emit()
  }
  private onStorage = (event: StorageEvent) => {
    if (event.key === PHOTO_CACHE_KEY) for (const photo of Object.values(readPhotoCache())) this.accept(photo)
  }
  private start() {
    this.controller = new AbortController()
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        this.channel = new BroadcastChannel(PHOTO_CHANNEL)
        this.channel.onmessage = event => {
          const result = cachedPhotoSchema.safeParse(event.data)
          if (result.success) this.accept(result.data)
        }
      } catch (error) {
        if (!(error instanceof DOMException)) throw error
        // Manifest polling also works when browser policy blocks BroadcastChannel.
      }
    }
    globalThis.addEventListener?.('storage', this.onStorage)
    void this.refresh()
    this.timer = setInterval(() => void this.refresh(), 1000)
  }
  private stop() {
    this.controller?.abort()
    this.channel?.close()
    this.channel = undefined
    clearInterval(this.timer)
    globalThis.removeEventListener?.('storage', this.onStorage)
  }

  async refresh(): Promise<void> {
    if (this.polling) return
    this.polling = true
    const signal = this.controller?.signal
    const revision = this.revision
    const downloads: PhotoMeta[] = []
    try {
      const manifest = manifestSchema.parse(await http.get(this.url('/api/v1/inventory/photos'), { signal }).json())
      if (signal?.aborted || this.revision !== revision) return
      const next: Record<string, ProductPhoto> = {}
      let changed = Object.keys(this.photos).length !== manifest.length
      for (const meta of manifest) {
        const current = this.photos[meta.item_id]
        if (current?.version === meta.version) {
          next[meta.item_id] = current
          if (!current.src.startsWith('data:')) downloads.push(meta)
        }
        else {
          next[meta.item_id] = { ...meta, src: this.photoUrl(meta) }
          downloads.push(meta)
          changed = true
        }
      }
      if (changed) { this.photos = next; persistPhotoCache(next); this.emit() }
    } catch (error) {
      if (!(error instanceof Error)) throw error
      // Offline/old-backend responses preserve cached photos; the next poll retries.
    } finally { this.polling = false }
    // Binary downloads never hold the manifest poll, so slow images do not delay live updates.
    await Promise.all(downloads.map(meta => this.cachePhoto(meta, signal)))
  }

  private async cachePhoto(meta: PhotoMeta, signal: AbortSignal | undefined): Promise<void> {
    const key = `${meta.item_id}:${meta.version}`
    if (this.downloading.has(key) || this.downloading.size >= 4) return
    this.downloading.add(key)
    try {
      const blob = await http.get(this.photoUrl(meta), { signal }).blob()
      const src = await readPhotoFile(blob)
      if (!signal?.aborted && this.photos[meta.item_id]?.version === meta.version) this.accept({ ...meta, src })
    } catch (error) {
      if (!(error instanceof Error)) throw error
      // Keep the direct server URL; retry cache hydration on the next manifest tick.
    } finally { this.downloading.delete(key) }
  }

  async upload(itemId: string, dataUrl: string): Promise<void> {
    try {
      const meta = photoMetaSchema.parse(await http.post(this.url(`/api/v1/inventory/${encodeURIComponent(itemId)}/photo`), {
        json: { image_data_url: dataUrl },
      }).json())
      const photo = cachedPhotoSchema.parse({ ...meta, src: dataUrl })
      this.accept(photo)
      try { this.channel?.postMessage(photo) }
      catch (error) { if (!(error instanceof DOMException)) throw error }
    } catch (error) {
      if (error instanceof HTTPError) {
        const message = error.response.status === 401 ? '관리자 세션이 만료되었습니다. 다시 로그인해 주세요.'
          : error.response.status === 413 ? '사진은 1MB 이하로 선택해 주세요.' : '사진을 저장하지 못했습니다. 상품과 사진 형식을 확인해 주세요.'
        throw new ProductPhotoError(message, error.response.status)
      }
      throw error
    }
  }
}
