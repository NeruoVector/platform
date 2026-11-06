import { useSyncExternalStore } from 'react'
import { ProductPhotoStore } from './productPhotoSync.ts'

export const productPhotoStore = new ProductPhotoStore((import.meta.env?.VITE_API_BASE_URL || '').replace(/\/$/, ''))
export function useProductPhotos() {
  return useSyncExternalStore(productPhotoStore.subscribe, productPhotoStore.getSnapshot, productPhotoStore.getSnapshot)
}
