import ky from 'ky'
import { z } from 'zod'

const vector = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()])

export const campusSchema = z.object({
  campus: z.object({
    size_m: z.tuple([z.number().positive(), z.number().positive()]),
    ground_center_enu: vector,
    mesh_pose_enu: vector,
    mesh_scale: vector,
  }),
  takeoff_enu: vector,
})

export const liveCampusSchema = z.object({
  timestamp: z.number().finite(),
  drone_id: z.string().min(1),
  position_enu: vector.nullable(),
  mode: z.string(),
  armed: z.boolean(),
})

export type Campus = z.infer<typeof campusSchema>
export type LiveCampus = z.infer<typeof liveCampusSchema>
export type EnuPosition = readonly [number, number, number]

export function worldToScene([east, north, up]: EnuPosition): [number, number, number] {
  return [east, up, -north]
}

export async function loadCampus(signal: AbortSignal) {
  const [fixture, mesh] = await Promise.all([
    ky.get('/simulation/assets/school.json', { signal, timeout: 15000 }).json<unknown>(),
    ky.get('/simulation/assets/school_map.dae', { signal, timeout: 45000 }).text(),
  ])
  return { fixture: campusSchema.parse(fixture), mesh }
}

export async function loadLiveCampus(signal: AbortSignal): Promise<LiveCampus> {
  const response = await ky.get('/simulation/live/state.json', {
    signal, timeout: 5000, retry: 0, cache: 'no-store',
  }).json<unknown>()
  return liveCampusSchema.parse(response)
}

export function isCampusFresh(snapshot: LiveCampus, now: number): boolean {
  const age = now / 1000 - snapshot.timestamp
  return age >= -2 && age < 5
}
