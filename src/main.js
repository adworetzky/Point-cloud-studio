import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { PointCloud } from './pointCloud.js'
import { initUI } from './ui.js'

// ─── Scene setup ───────────────────────────────────────────────────────────

const canvas = document.getElementById('canvas')

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
  preserveDrawingBuffer: true, // needed for screenshot
})
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setClearColor(0x020a08, 1)

const scene = new THREE.Scene()
scene.fog = new THREE.FogExp2(0x020a08, 0.008)

const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000)
camera.position.set(0, 0, 70)

const controls = new OrbitControls(camera, canvas)
controls.enableDamping = true
controls.dampingFactor = 0.06
controls.rotateSpeed = 0.6
controls.panSpeed = 0.5
controls.zoomSpeed = 0.8
controls.minDistance = 5
controls.maxDistance = 300

// Subtle ambient grid — adds to the terminal feel
function addGrid() {
  const grid = new THREE.GridHelper(200, 40, 0x003322, 0x001a11)
  grid.position.y = -40
  grid.material.opacity = 0.3
  grid.material.transparent = true
  scene.add(grid)
}
addGrid()

// ─── Parameters ───────────────────────────────────────────────────────────

const params = {
  seed: 42,
  cloudStyle: 'organic',   // 'organic' | 'structural'
  pointCount: 800,
  cloudRadius: 30,
  noiseScale: 0.35,
  noiseStrength: 0.55,
  pointSize: 2.0,
  connectionsEnabled: true,
  connectionDist: 8,
  lineOpacity: 0.25,
  lineWidth: 0.5,
  driftEnabled: true,
  driftSpeed: 0.08,
  driftAmp: 1.2,
}

// ─── Point cloud ──────────────────────────────────────────────────────────

let cloud = new PointCloud(scene, { ...params })

// ─── Hover / raycasting ───────────────────────────────────────────────────

const raycaster = new THREE.Raycaster()
raycaster.params.Points.threshold = 1.5
const mouse = new THREE.Vector2(-9999, -9999)
const tooltip = document.getElementById('hover-tooltip')

canvas.addEventListener('mousemove', e => {
  const rect = canvas.getBoundingClientRect()
  mouse.x =  ((e.clientX - rect.left) / rect.width)  * 2 - 1
  mouse.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1

  tooltip.style.left = (e.clientX + 14) + 'px'
  tooltip.style.top  = (e.clientY - 10) + 'px'
})

canvas.addEventListener('mouseleave', () => {
  mouse.set(-9999, -9999)
  cloud.setHovered(-1)
  tooltip.style.display = 'none'
})

function doRaycast() {
  if (!cloud.pointsMesh) return
  raycaster.setFromCamera(mouse, camera)
  const hits = raycaster.intersectObject(cloud.pointsMesh)
  if (hits.length > 0) {
    const idx = hits[0].index
    cloud.setHovered(idx)
    const pos = cloud.pointsMesh.geometry.attributes.position
    tooltip.textContent = `PT ${idx.toString().padStart(4,'0')}  [${pos.getX(idx).toFixed(2)}, ${pos.getY(idx).toFixed(2)}, ${pos.getZ(idx).toFixed(2)}]`
    tooltip.style.display = 'block'
  } else {
    cloud.setHovered(-1)
    tooltip.style.display = 'none'
  }
}

// ─── Resize ───────────────────────────────────────────────────────────────

function resize() {
  const isMobile = window.innerWidth <= 768
  const sidebar = document.getElementById('sidebar')
  const sw = (!isMobile && sidebar) ? sidebar.offsetWidth : 0
  const w = window.innerWidth - sw
  const h = window.innerHeight
  renderer.setSize(w, h)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  // Keep shader size-attenuation in sync with physical canvas height
  cloud.setRendererScale(renderer.domElement.height / 2)
}
window.addEventListener('resize', resize)
resize()

// ─── FPS counter ──────────────────────────────────────────────────────────

let fpsFrames = 0, fpsLast = performance.now()
const statFps = document.getElementById('stat-fps')

// ─── Rebuild helper ───────────────────────────────────────────────────────

function rebuildCloud() {
  cloud._disposeAll()
  cloud = new PointCloud(scene, { ...params })
  cloud.setRendererScale(renderer.domElement.height / 2)
  updateStats()
}

function updateStats() {
  const s = cloud.stats
  document.getElementById('stat-points').textContent = s.points
  document.getElementById('stat-edges').textContent  = s.edges
  document.getElementById('stat-seed').textContent   = params.seed
}

// ─── UI ───────────────────────────────────────────────────────────────────

initUI(params, {
  onRebuild: rebuildCloud,
  onParamChange: (key, value) => {
    params[key] = value
    cloud.applyParam(key, value)
    updateStats()
  },
  onScreenshot: () => {
    // Render one clean frame first
    renderer.render(scene, camera)
    const link = document.createElement('a')
    link.download = `pcs_${params.seed}_${Date.now()}.png`
    link.href = canvas.toDataURL('image/png')
    link.click()
  },
})

updateStats()

// ─── Mobile panel toggle ──────────────────────────────────────────────────

const panelToggle = document.getElementById('panel-toggle')
const sidebarEl   = document.getElementById('sidebar')

panelToggle?.addEventListener('click', () => {
  const isOpen = sidebarEl.classList.toggle('panel-open')
  panelToggle.textContent = isOpen ? '×' : '≡'
})

// ─── Animation loop ───────────────────────────────────────────────────────

const clock = new THREE.Clock()

function animate() {
  requestAnimationFrame(animate)

  const elapsed = clock.getElapsedTime()
  controls.update()
  doRaycast()
  cloud.update(elapsed)
  renderer.render(scene, camera)

  // FPS
  fpsFrames++
  const now = performance.now()
  if (now - fpsLast >= 500) {
    statFps.textContent = Math.round(fpsFrames / ((now - fpsLast) / 1000))
    fpsFrames = 0
    fpsLast = now
  }
}

animate()
