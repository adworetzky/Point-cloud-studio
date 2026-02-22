import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { PointCloud, COLOR_THEMES } from './pointCloud.js'
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

// ─── Post-processing (bloom) ──────────────────────────────────────────────

const renderPass  = new RenderPass(scene, camera)  // camera ref updated in animate
const bloomPass   = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.8, 0.4, 0.2)
const outputPass  = new OutputPass()
const composer    = new EffectComposer(renderer)
composer.addPass(renderPass)
composer.addPass(bloomPass)
composer.addPass(outputPass)
let bloomEnabled  = false

const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000)
camera.position.set(0, 0, 70)

// Orthographic camera — toggled with [O] / ortho button
const orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000)
orthoCamera.position.set(0, 0, 70)
let useOrtho = false
let activeCamera = camera

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
  cloudStyle: 'organic',    // 'organic' | 'structural' | 'image' | 'crystal' | 'terrain' | 'fractal' | 'galaxy'
  colorTheme: 'cityscan',   // 'cityscan' | 'cosmic' | 'bio' | 'infrared' | 'mono' | 'sunset'
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
  // Animation
  autoSpin:  false,
  spinSpeed: 0.4,
  // Style-specific
  galaxyArms:    3,
  terrainStrata: 5,
  // Positional hue shift
  colorMode:  'theme',  // 'theme' | 'positional'
  hueAxis:    'y',      // 'y' | 'radial' | 'x' | 'z'
  hueRange:   120,      // degrees of hue sweep (0–360)
  hueOffset:  0,        // base hue rotation (0–360)
  // Image-driven mode
  imageData:    null,        // Uint8ClampedArray | null
  imageWidth:   0,
  imageHeight:  0,
  imageMapMode: 'height',   // 'height' | 'density'
}

// ─── URL param sharing ────────────────────────────────────────────────────

const SHAREABLE    = ['seed','cloudStyle','colorTheme','pointCount','cloudRadius',
  'noiseScale','noiseStrength','pointSize','connectionsEnabled','connectionDist',
  'lineOpacity','driftEnabled','driftSpeed','driftAmp','imageMapMode',
  'autoSpin','spinSpeed','galaxyArms','terrainStrata',
  'colorMode','hueAxis','hueRange','hueOffset']
const BOOL_PARAMS  = new Set(['connectionsEnabled','driftEnabled','autoSpin'])
const STRING_PARAMS = new Set(['cloudStyle','colorTheme','imageMapMode','colorMode','hueAxis'])

const urlP = new URLSearchParams(window.location.search)
for (const key of SHAREABLE) {
  if (!urlP.has(key)) continue
  const raw = urlP.get(key)
  if (BOOL_PARAMS.has(key))    params[key] = raw === 'true'
  else if (STRING_PARAMS.has(key)) params[key] = raw
  else { const v = parseFloat(raw); if (!isNaN(v)) params[key] = v }
}

// Apply theme-dependent renderer settings if loaded from URL
{
  const theme = COLOR_THEMES[params.colorTheme] || COLOR_THEMES.cityscan
  renderer.setClearColor(theme.bg, 1)
  scene.fog.color.setHex(theme.fog)
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
  cloud.gravityTarget = null
})

// ─── Gravity cursor ───────────────────────────────────────────────────────

let gravityActive = false
const gravityPlane     = new THREE.Plane()
const gravityIntersect = new THREE.Vector3()

canvas.addEventListener('mousedown', e => { if (e.button === 0) gravityActive = true })
canvas.addEventListener('mouseup',   e => { if (e.button === 0) { gravityActive = false; cloud.gravityTarget = null } })

function updateGravityTarget() {
  if (!gravityActive) return
  gravityPlane.setFromNormalAndCoplanarPoint(
    activeCamera.position.clone().normalize(),
    new THREE.Vector3(0, 0, 0)
  )
  raycaster.setFromCamera(mouse, activeCamera)
  if (raycaster.ray.intersectPlane(gravityPlane, gravityIntersect)) {
    cloud.gravityTarget = cloud.group.worldToLocal(gravityIntersect.clone())
  }
}

// ─── Click-to-explode ─────────────────────────────────────────────────────

canvas.addEventListener('click', e => {
  if (!cloud.pointsMesh) return
  // Only explode on quick clicks (not after drag)
  const rect = canvas.getBoundingClientRect()
  const clickMouse = new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width)  * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1
  )
  raycaster.setFromCamera(clickMouse, activeCamera)
  const hits = raycaster.intersectObject(cloud.pointsMesh)
  if (hits.length > 0) {
    const localPt = cloud.group.worldToLocal(hits[0].point.clone())
    cloud.explode(localPt)
  }
})

function doRaycast() {
  if (!cloud.pointsMesh) return
  raycaster.setFromCamera(mouse, activeCamera)
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
  // Sync ortho frustum to match current view distance
  const dist = orthoCamera.position.length()
  const halfH = Math.tan(THREE.MathUtils.degToRad(30)) * dist
  const halfW = halfH * (w / h)
  orthoCamera.left   = -halfW; orthoCamera.right  = halfW
  orthoCamera.top    =  halfH; orthoCamera.bottom = -halfH
  orthoCamera.updateProjectionMatrix()
  // Keep shader size-attenuation in sync with physical canvas height
  cloud.setRendererScale(renderer.domElement.height / 2)
  composer.setSize(w, h)
}

function toggleOrtho() {
  useOrtho = !useOrtho
  activeCamera = useOrtho ? orthoCamera : camera
  orthoCamera.position.copy(camera.position)
  orthoCamera.quaternion.copy(camera.quaternion)
  controls.object = activeCamera
  controls.update()
  const btn = document.getElementById('btn-ortho')
  if (btn) btn.classList.toggle('mode-active', useOrtho)
  resize()
}
window.addEventListener('resize', resize)
resize()

// ─── FPS counter ──────────────────────────────────────────────────────────

let fpsFrames = 0, fpsLast = performance.now()
const statFps = document.getElementById('stat-fps')

// ─── Rebuild helper ───────────────────────────────────────────────────────

function rebuildCloud() {
  const prevRotY = cloud.group.rotation.y   // preserve spin angle across rebuilds
  cloud.dispose()
  cloud = new PointCloud(scene, { ...params })
  cloud.group.rotation.y = prevRotY
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
    if (key === 'colorTheme') {
      const theme = COLOR_THEMES[value] || COLOR_THEMES.cityscan
      renderer.setClearColor(theme.bg, 1)
      scene.fog.color.setHex(theme.fog)
      cloud.applyTheme(value)
    } else {
      cloud.applyParam(key, value)
    }
    updateStats()
  },
  onScreenshot: () => {
    renderer.render(scene, activeCamera)
    const link = document.createElement('a')
    link.download = `pcs_${params.seed}_${Date.now()}.png`
    link.href = canvas.toDataURL('image/png')
    link.click()
  },
  onExportPLY: () => {
    const pos = cloud.pointsMesh.geometry.attributes.position.array
    const n   = cloud.pointCount
    const lines = [
      'ply', 'format ascii 1.0',
      `element vertex ${n}`,
      'property float x', 'property float y', 'property float z',
      'end_header',
    ]
    for (let i = 0; i < n; i++) {
      lines.push(`${pos[i*3].toFixed(4)} ${pos[i*3+1].toFixed(4)} ${pos[i*3+2].toFixed(4)}`)
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' })
    const link = document.createElement('a')
    link.download = `pcs_${params.seed}.ply`
    link.href = URL.createObjectURL(blob)
    link.click()
    URL.revokeObjectURL(link.href)
  },
  onEmbed: () => {
    const sp = new URLSearchParams()
    for (const key of SHAREABLE) sp.set(key, String(params[key]))
    const url  = `${location.origin}${location.pathname}?${sp.toString()}`
    const html = `<iframe src="${url}" width="900" height="600" style="border:none;display:block;"></iframe>`
    navigator.clipboard.writeText(html).then(() => {
      const btn = document.getElementById('btn-embed')
      if (!btn) return
      const orig = btn.textContent
      btn.textContent = '✓ COPIED'
      setTimeout(() => { btn.textContent = orig }, 1500)
    }).catch(() => { prompt('Copy this embed code:', html) })
  },
  onShare: () => {
    const sp = new URLSearchParams()
    for (const key of SHAREABLE) sp.set(key, String(params[key]))
    const url = `${location.origin}${location.pathname}?${sp.toString()}`
    navigator.clipboard.writeText(url).then(() => {
      const btn = document.getElementById('btn-share')
      if (!btn) return
      const orig = btn.textContent
      btn.textContent = '✓ COPIED'
      setTimeout(() => { btn.textContent = orig }, 1500)
    }).catch(() => { prompt('Copy this URL:', url) })
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
let prevTime = 0

function animate() {
  requestAnimationFrame(animate)

  const elapsed = clock.getElapsedTime()
  const dt      = elapsed - prevTime
  prevTime      = elapsed

  controls.update()
  updateGravityTarget()
  doRaycast()
  cloud.update(elapsed)

  if (params.autoSpin) {
    cloud.group.rotation.y += params.spinSpeed * dt
  }

  renderPass.camera = activeCamera
  if (bloomEnabled) {
    composer.render()
  } else {
    renderer.render(scene, activeCamera)
  }

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

// ─── Keyboard shortcuts ───────────────────────────────────────────────────

const STYLE_KEYS = {
  '1': 'organic', '2': 'structural',       '3': 'image',
  '4': 'crystal', '5': 'terrain',          '6': 'fractal', '7': 'galaxy',
  '8': 'reactiondiffusion', '9': 'fluid',  '0': 'lsystem',
}

function toggleShortcuts() {
  const el = document.getElementById('shortcuts-overlay')
  if (el) el.style.display = el.style.display === 'none' ? 'flex' : 'none'
}

document.getElementById('btn-help')?.addEventListener('click', toggleShortcuts)
document.getElementById('btn-ortho')?.addEventListener('click', toggleOrtho)

// Bloom controls
function setBloom(enabled) {
  bloomEnabled = enabled
  const btn = document.getElementById('btn-bloom')
  if (btn) { btn.classList.toggle('mode-active', enabled); btn.textContent = enabled ? 'ON' : 'OFF' }
  const ctrls = document.getElementById('bloom-controls')
  if (ctrls) ctrls.style.opacity = enabled ? '1' : '0.35'
}
document.getElementById('btn-bloom')?.addEventListener('click', () => setBloom(!bloomEnabled))

const bloomStrengthEl = document.getElementById('bloomStrength')
const bloomRadiusEl   = document.getElementById('bloomRadius')
const bloomThreshEl   = document.getElementById('bloomThreshold')

bloomStrengthEl?.addEventListener('input', () => {
  bloomPass.strength = parseFloat(bloomStrengthEl.value)
  const v = document.getElementById('bloomStrength-val')
  if (v) v.textContent = parseFloat(bloomStrengthEl.value).toFixed(1)
})
bloomRadiusEl?.addEventListener('input', () => {
  bloomPass.radius = parseFloat(bloomRadiusEl.value)
  const v = document.getElementById('bloomRadius-val')
  if (v) v.textContent = parseFloat(bloomRadiusEl.value).toFixed(2)
})
bloomThreshEl?.addEventListener('input', () => {
  bloomPass.threshold = parseFloat(bloomThreshEl.value)
  const v = document.getElementById('bloomThreshold-val')
  if (v) v.textContent = parseFloat(bloomThreshEl.value).toFixed(2)
})

// CRT overlay toggle
function toggleCRT() {
  const overlay = document.getElementById('crt-overlay')
  if (!overlay) return
  overlay.classList.toggle('crt-active')
  const btn = document.getElementById('btn-crt')
  if (btn) btn.classList.toggle('mode-active', overlay.classList.contains('crt-active'))
}
document.getElementById('btn-crt')?.addEventListener('click', toggleCRT)

document.getElementById('shortcuts-overlay')?.addEventListener('click', e => {
  if (e.target === e.currentTarget) toggleShortcuts()
})

document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
  if (e.ctrlKey || e.metaKey || e.altKey) return

  if (e.key === 'Escape') {
    const el = document.getElementById('shortcuts-overlay')
    if (el && el.style.display !== 'none') { el.style.display = 'none'; return }
  }

  if (e.key === '/' || e.key === '?') {
    e.preventDefault()
    toggleShortcuts()
    return
  }

  if (STYLE_KEYS[e.key]) {
    document.getElementById(`mode-${STYLE_KEYS[e.key]}`)?.click()
    return
  }

  switch (e.key.toLowerCase()) {
    case 'r': document.getElementById('btn-regenerate')?.click();       break
    case 'c': document.getElementById('btn-screenshot')?.click();       break
    case 'u': document.getElementById('btn-share')?.click();            break
    case 'p': document.getElementById('autoSpin')?.click();             break
    case 'n': document.getElementById('connectionsEnabled')?.click();   break
    case 'd': document.getElementById('driftEnabled')?.click();         break
    case 'o': toggleOrtho();                                            break
    case 'k': toggleCRT();                                              break
    case 'x': cloud.explode(new THREE.Vector3(0, 0, 0));               break
  }
})
