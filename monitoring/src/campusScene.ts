import * as THREE from 'three'
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { worldToScene } from './campusData'
import type { Campus, LiveCampus } from './campusData'

export type CampusScene = {
  readonly update: (snapshot: LiveCampus, fresh: boolean) => void
  readonly reset: () => void
  readonly top: () => void
  readonly focus: () => void
  readonly dispose: () => void
}

class CampusMeshError extends Error {
  constructor() {
    super('학교 모델 형식을 읽을 수 없습니다.')
    this.name = 'CampusMeshError'
  }
}

export function createCampusScene(host: HTMLDivElement, fixture: Campus, mesh: string): CampusScene {
  const imported = new ColladaLoader().parse(mesh, '/simulation/assets/')
  if (!imported) throw new CampusMeshError()
  const campus = imported.scene
  const styles = getComputedStyle(host)
  const token = (name: string) => styles.getPropertyValue(name).trim()
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.domElement.tabIndex = 0
  renderer.domElement.setAttribute('role', 'img')
  renderer.domElement.setAttribute('aria-label', '학교 전체 3D 지도와 실시간 기체 위치')
  renderer.domElement.setAttribute('aria-describedby', 'campus-map-help')
  host.append(renderer.domElement)
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(token('--campus-sky'))
  scene.add(new THREE.HemisphereLight(0xffffff, 0x54624b, 2.3))
  const sun = new THREE.DirectionalLight(0xffffff, 2)
  sun.position.set(-40, 100, 40)
  scene.add(sun)
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 1200)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.maxPolarAngle = Math.PI / 2 - 0.03
  controls.minDistance = 5
  controls.maxDistance = 600
  controls.listenToKeyEvents(renderer.domElement)
  const [scaleX, scaleY, scaleZ] = fixture.campus.mesh_scale
  campus.scale.set(scaleX, scaleY, scaleZ)
  campus.position.set(...worldToScene(fixture.campus.mesh_pose_enu))
  campus.name = 'actual-school-campus'
  scene.add(campus)
  const bounds = new THREE.Box3().setFromObject(campus)
  const center = bounds.getCenter(new THREE.Vector3())
  const frameBounds = bounds.clone().expandByScalar(5)
  let triangles = 0
  campus.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      triangles += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3
    }
  })
  renderer.domElement.dataset.triangleCount = String(triangles)
  const groundMaterial = new THREE.MeshLambertMaterial({ color: token('--campus-ground') })
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(...fixture.campus.size_m), groundMaterial)
  ground.rotation.x = -Math.PI / 2
  ground.position.set(...worldToScene(fixture.campus.ground_center_enu))
  ground.position.y -= 0.06
  scene.add(ground)
  const droneColor = new THREE.Color(token('--campus-drone'))
  const droneMaterial = new THREE.MeshBasicMaterial({ color: droneColor, depthTest: false })
  // Anchor the position marker's bottom at telemetry, so it clears the ground.
  const droneGeometry = new THREE.SphereGeometry(1.1, 16, 10)
  droneGeometry.translate(0, 1.1, 0)
  const drone = new THREE.Mesh(droneGeometry, droneMaterial)
  drone.renderOrder = 2
  drone.visible = false
  scene.add(drone)
  const footprint = new THREE.Mesh(new THREE.RingGeometry(1.6, 2, 32), droneMaterial)
  footprint.rotation.x = -Math.PI / 2
  footprint.renderOrder = 2
  footprint.visible = false
  scene.add(footprint)
  const altitude = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
    new THREE.LineBasicMaterial({ color: droneColor, depthTest: false }),
  )
  altitude.renderOrder = 2
  altitude.visible = false
  scene.add(altitude)
  let disposed = false
  let dirty = true
  let interacted = false
  let lastFrame = 0
  const compassPoint = new THREE.Vector3()
  const compassCenter = new THREE.Vector3()
  const north = new THREE.Vector3(0, 0, -10)
  const onStart = () => { interacted = true }
  controls.addEventListener('start', onStart)
  const distance = (direction: THREE.Vector3) => {
    const right = new THREE.Vector3().crossVectors(camera.up, direction).normalize()
    const up = new THREE.Vector3().crossVectors(direction, right).normalize()
    const vertical = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
    const horizontal = vertical * camera.aspect
    let fit = 0
    for (const x of [frameBounds.min.x, frameBounds.max.x]) {
      for (const y of [frameBounds.min.y, frameBounds.max.y]) {
        for (const z of [frameBounds.min.z, frameBounds.max.z]) {
          const corner = new THREE.Vector3(x, y, z).sub(center)
          fit = Math.max(fit, corner.dot(direction) + Math.max(Math.abs(corner.dot(right)) / horizontal, Math.abs(corner.dot(up)) / vertical))
        }
      }
    }
    return fit * 1.12
  }
  const reset = () => {
    dirty = true
    const direction = new THREE.Vector3(0.55, 0.85, 1).normalize()
    controls.target.copy(center)
    camera.position.copy(center).add(direction.clone().multiplyScalar(distance(direction)))
    controls.update()
    interacted = false
  }
  const resize = () => {
    const { width, height } = host.getBoundingClientRect()
    if (width === 0 || height === 0) return
    renderer.setSize(width, height, false)
    dirty = true
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    if (!interacted) reset()
  }
  const observer = new ResizeObserver(resize)
  observer.observe(host)
  resize()
  const render = (now: number) => {
    if (disposed) return
    if (document.hidden || now - lastFrame < 32) return
    lastFrame = now
    const changed = controls.update()
    if (!dirty && !changed) return
    dirty = false
    compassCenter.copy(controls.target).project(camera)
    compassPoint.copy(controls.target).add(north).project(camera)
    host.parentElement?.style.setProperty('--campus-north-angle', `${Math.atan2(compassPoint.x - compassCenter.x, compassPoint.y - compassCenter.y)}rad`)
    renderer.render(scene, camera)
  }
  renderer.setAnimationLoop(render)
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== '+' && event.key !== '-' && event.key !== '=') return
    event.preventDefault()
    const direction = camera.position.clone().sub(controls.target)
    const factor = event.key === '-' ? 1.2 : 1 / 1.2
    const length = THREE.MathUtils.clamp(direction.length() * factor, 5, 600)
    camera.position.copy(controls.target).add(direction.setLength(length))
    dirty = true
    controls.update()
    interacted = true
  }
  renderer.domElement.addEventListener('keydown', onKey)
  return {
    reset,
    top: () => {
      dirty = true
      controls.target.copy(center)
      const direction = new THREE.Vector3(0, 1, 0.0001).normalize()
      camera.position.copy(center).add(direction.clone().multiplyScalar(distance(direction)))
      controls.update()
      interacted = true
    },
    focus: () => {
      if (!drone.visible) return
      dirty = true
      controls.target.copy(drone.position)
      camera.position.copy(drone.position).add(new THREE.Vector3(15, 20, 25))
      controls.update()
      interacted = true
    },
    update: (snapshot, fresh) => {
      dirty = true
      const position = snapshot.position_enu
      drone.visible = position !== null
      footprint.visible = position !== null
      altitude.visible = position !== null
      renderer.domElement.dataset.updatedAt = String(snapshot.timestamp)
      if (!position) {
        delete renderer.domElement.dataset.droneEnu
        return
      }
      drone.position.set(...worldToScene(position))
      footprint.position.set(drone.position.x, 0.06, drone.position.z)
      altitude.geometry.setFromPoints([footprint.position, drone.position])
      droneMaterial.color.set(fresh ? droneColor : token('--campus-muted'))
      altitude.material.color.copy(droneMaterial.color)
      renderer.domElement.dataset.droneEnu = JSON.stringify(position)
    },
    dispose: () => {
      disposed = true
      renderer.setAnimationLoop(null)
      observer.disconnect()
      controls.dispose()
      renderer.domElement.removeEventListener('keydown', onKey)
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
          object.geometry.dispose()
          const materials = Array.isArray(object.material) ? object.material : [object.material]
          for (const material of materials) material.dispose()
        }
      })
      renderer.dispose()
      renderer.forceContextLoss()
      renderer.domElement.remove()
    },
  }
}
