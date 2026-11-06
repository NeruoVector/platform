import { z } from 'zod'

export const PHOTO_CACHE_KEY = 'nv:product-photos:v1'
export const PHOTO_CHANNEL = 'nv:product-photos:v1'
export const MAX_PHOTO_BYTES = 1024 * 1024
export const PHOTO_CACHE_CHARACTERS = 1_800_000
export const photoMetaSchema = z.object({
  item_id: z.uuid(), version: z.uuid(), mime: z.enum(['image/jpeg', 'image/png', 'image/webp']),
})
const dataUrlSchema = z.string().max(1_398_136).regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/)
export const cachedPhotoSchema = photoMetaSchema.extend({ src: dataUrlSchema })
const cacheSchema = z.array(cachedPhotoSchema).max(500)
export type PhotoMeta = z.infer<typeof photoMetaSchema>
export type ProductPhoto = PhotoMeta & { readonly src: string }
export type PhotoSnapshot = Readonly<Record<string, ProductPhoto>>

function storageUnavailable(error: unknown): boolean {
  return error instanceof DOMException && ['QuotaExceededError', 'SecurityError', 'InvalidStateError'].includes(error.name)
}

export function readPhotoCache(): PhotoSnapshot {
  try {
    const raw = globalThis.localStorage?.getItem(PHOTO_CACHE_KEY)
    if (!raw || raw.length > PHOTO_CACHE_CHARACTERS) return {}
    const parsed = cacheSchema.safeParse(JSON.parse(raw))
    return parsed.success ? Object.fromEntries(parsed.data.map(photo => [photo.item_id, photo])) : {}
  } catch (error) {
    if (error instanceof SyntaxError || storageUnavailable(error)) return {}
    throw error
  }
}

export function persistPhotoCache(photos: PhotoSnapshot): void {
  const entries: ProductPhoto[] = []
  let characters = 2
  for (const photo of Object.values(photos).reverse()) {
    if (!photo.src.startsWith('data:')) continue
    const size = JSON.stringify(photo).length + 1
    if (characters + size > PHOTO_CACHE_CHARACTERS) continue
    entries.unshift(photo)
    characters += size
  }
  try {
    globalThis.localStorage?.setItem(PHOTO_CACHE_KEY, JSON.stringify(entries))
  } catch (error) {
    if (!storageUnavailable(error)) throw error
    // The in-memory photo and server URL remain usable with storage disabled/full.
  }
}

export class ProductPhotoError extends Error {
  readonly status: number
  constructor(message: string, status = 0) { super(message); this.status = status }
}

export function readPhotoFile(file: Blob): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size === 0 || file.size > MAX_PHOTO_BYTES) {
    return Promise.reject(new ProductPhotoError('JPG·PNG·WebP 사진을 1MB 이하로 선택해 주세요.'))
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new ProductPhotoError('사진을 읽지 못했습니다. 다시 선택해 주세요.'))
    reader.onload = () => {
      const parsed = dataUrlSchema.safeParse(reader.result)
      if (parsed.success) resolve(parsed.data)
      else reject(new ProductPhotoError('사진 형식을 확인해 주세요.'))
    }
    reader.readAsDataURL(file)
  })
}
