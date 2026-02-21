import * as THREE from 'three'
import { PerlinNoise } from './noise.js'

// ─── Color themes ────────────────────────────────────────────────────────────

export const COLOR_THEMES = {
  cityscan: {
    base:  0x00ffe0,
    dim:   0x004d45,
    hover: 0xffffff,
    conn:  0x80fff0,
    bg:    0x020a08,
    fog:   0x020a08,
  },
  cosmic: {
    base:  0xaa66ff,
    dim:   0x220033,
    hover: 0xffffff,
    conn:  0xcc99ff,
    bg:    0x04010a,
    fog:   0x04010a,
  },
  bio: {
    base:  0x44ff88,
    dim:   0x003322,
    hover: 0xffffff,
    conn:  0x88ffbb,
    bg:    0x010a04,
    fog:   0x010a04,
  },
  infrared: {
    base:  0xff5500,
    dim:   0x3a0800,
    hover: 0xffffff,
    conn:  0xff8844,
    bg:    0x070100,
    fog:   0x070100,
  },
  mono: {
    base:  0xd0d0d0,
    dim:   0x1e1e1e,
    hover: 0xffffff,
    conn:  0x909090,
    bg:    0x040404,
    fog:   0x040404,
  },
  sunset: {
    base:  0xff6eb4,
    dim:   0x280a1e,
    hover: 0xffffff,
    conn:  0xff99cc,
    bg:    0x08010a,
    fog:   0x08010a,
  },
}

// ─── Point shader ────────────────────────────────────────────────────────────

const POINT_VERT = `
  attribute vec3 color;
  varying vec3 vColor;
  uniform float uSize;
  uniform float uScale;

  void main() {
    vColor = color;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    // Replicate Three.js sizeAttenuation: size * (rendererHeight/2) / -mvPosition.z
    gl_PointSize = uSize * uScale / -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
  }
`

const POINT_FRAG = `
  varying vec3 vColor;

  void main() {
    // gl_PointCoord goes 0→1; map to -1→1 for circle test
    vec2 uv = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(uv, uv);
    if (r2 > 1.0) discard;
    // Soft anti-aliased edge
    float alpha = 1.0 - smoothstep(0.6, 1.0, r2);
    gl_FragColor = vec4(vColor, alpha);
  }
`

// ─── Edge shader ─────────────────────────────────────────────────────────────

const LINE_VERT = `
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const LINE_FRAG = `
  uniform float uOpacity;
  uniform vec3  uColor;

  void main() {
    gl_FragColor = vec4(uColor * uOpacity, uOpacity);
  }
`

/**
 * PointCloud — manages geometry, connections, drift, and hover.
 */
export class PointCloud {
  constructor(scene, params) {
    this.scene = scene
    this.params = params
    this.noise = new PerlinNoise(params.seed)

    // Group holds all meshes — lets external code rotate the whole cloud
    this.group = new THREE.Group()
    scene.add(this.group)

    // Physical renderer half-height for size attenuation (updated via setRendererScale)
    this._rendererScale = window.innerHeight * Math.min(window.devicePixelRatio, 2) / 2

    // Runtime state
    this.basePositions = null   // Float32Array — stable "rest" positions
    this.driftOffsets  = null   // per-point random offsets for drift sampling
    this.pointCount    = 0
    this.edgeCount     = 0

    // Three.js objects
    this.pointsMesh  = null
    this.lineSegments = null

    // Connection pulse uniforms (set in _buildConnections)
    this._lineUniforms = null

    // Adjacency list for O(degree) BFS in setHovered
    this._adjacency = null

    // Hover
    this.hoveredIndex = -1

    this._build()
  }

  _build() {
    this._disposeAll()

    const p = this.params
    this.noise.reseed(p.seed)
    this.pointCount = p.pointCount

    const positions    = new Float32Array(p.pointCount * 3)
    const colors       = new Float32Array(p.pointCount * 3)
    this.driftOffsets  = new Float32Array(p.pointCount * 3)

    // Seeded LCG random — reproducible layouts
    let rs = p.seed
    function srnd() {
      rs = (rs * 1664525 + 1013904223) & 0xffffffff
      return (rs >>> 0) / 0xffffffff
    }

    if (p.cloudStyle === 'structural') {
      this._buildStructural(positions, colors, this.driftOffsets, srnd, p)
    } else if (p.cloudStyle === 'image') {
      this._buildImageDriven(positions, colors, this.driftOffsets, srnd, p)
    } else if (p.cloudStyle === 'crystal') {
      this._buildCrystal(positions, colors, this.driftOffsets, srnd, p)
    } else if (p.cloudStyle === 'terrain') {
      this._buildTerrain(positions, colors, this.driftOffsets, srnd, p)
    } else if (p.cloudStyle === 'fractal') {
      this._buildFractal(positions, colors, this.driftOffsets, srnd, p)
    } else if (p.cloudStyle === 'galaxy') {
      this._buildGalaxy(positions, colors, this.driftOffsets, srnd, p)
    } else {
      this._buildOrganic(positions, colors, this.driftOffsets, srnd, p)
    }

    this.basePositions = positions.slice()

    // Points geometry
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geo.setAttribute('color',    new THREE.BufferAttribute(colors, 3))

    // ShaderMaterial renders circular points instead of Three.js default squares
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uSize:  { value: p.pointSize },
        uScale: { value: this._rendererScale },
      },
      vertexShader:   POINT_VERT,
      fragmentShader: POINT_FRAG,
      transparent: true,
      depthWrite:  false,
    })

    this.pointsMesh = new THREE.Points(geo, mat)
    this.group.add(this.pointsMesh)

    this._buildConnections()
  }

  // ─── Theme helper ──────────────────────────────────────────────────────────

  _themeColors(p) {
    const t = COLOR_THEMES[p.colorTheme] || COLOR_THEMES.cityscan
    return {
      base:  new THREE.Color(t.base),
      dim:   new THREE.Color(t.dim),
      hover: new THREE.Color(t.hover),
      conn:  new THREE.Color(t.conn),
    }
  }

  // ─── Organic (default) cloud ───────────────────────────────────────────────

  _buildOrganic(positions, colors, driftOffsets, srnd, p) {
    const { base: baseColor, dim: dimColor } = this._themeColors(p)

    for (let i = 0; i < p.pointCount; i++) {
      // Spherical random distribution
      const theta = Math.acos(2 * srnd() - 1)
      const phi   = srnd() * Math.PI * 2
      const r     = srnd()

      const sx = Math.sin(theta) * Math.cos(phi)
      const sy = Math.sin(theta) * Math.sin(phi)
      const sz = Math.cos(theta)

      const nx = sx * p.cloudRadius * r
      const ny = sy * p.cloudRadius * r
      const nz = sz * p.cloudRadius * r

      const disp = this.noise.fbm3(
        nx * p.noiseScale,
        ny * p.noiseScale,
        nz * p.noiseScale,
        4
      )

      const scale = 1.0 + disp * p.noiseStrength
      positions[i * 3]     = nx * scale
      positions[i * 3 + 1] = ny * scale
      positions[i * 3 + 2] = nz * scale

      driftOffsets[i * 3]     = srnd() * 100
      driftOffsets[i * 3 + 1] = srnd() * 100
      driftOffsets[i * 3 + 2] = srnd() * 100

      // Color: noise-displacement-based brightness
      const t = Math.max(0, disp * 1.5)
      const c = baseColor.clone().lerp(dimColor, Math.max(0, 1 - t))
      colors[i * 3]     = c.r
      colors[i * 3 + 1] = c.g
      colors[i * 3 + 2] = c.b
    }
  }

  // ─── Structural / architectural city-scan cloud ────────────────────────────

  _buildStructural(positions, colors, driftOffsets, srnd, p) {
    const { base: baseColor, dim: dimColor } = this._themeColors(p)

    // Grid of building footprints filling the cloud radius
    const numCells  = Math.max(3, Math.round(p.cloudRadius / 8))
    const totalSize = p.cloudRadius * 1.6
    const cellSize  = totalSize / numCells
    const streetGap = cellSize * 0.22
    const bldgW     = cellSize - streetGap
    const halfBldg  = bldgW * 0.5

    // Pre-generate building heights
    const totalCells = numCells * numCells
    const heights    = new Float32Array(totalCells)
    let   maxH       = 0.001

    for (let k = 0; k < totalCells; k++) {
      const u = srnd()
      const h = u < 0.28
        ? srnd() * p.cloudRadius * 0.07
        : Math.pow(srnd(), 0.45) * p.cloudRadius * 0.85
      heights[k] = h
      if (h > maxH) maxH = h
    }

    const yCenter = -maxH * 0.35

    // LiDAR scan ring parameters — creates horizontal density bands on facades
    const numRings   = Math.max(8, Math.round(maxH / 3))
    const ringSpacing = maxH / numRings

    // Weighted CDF — taller buildings attract proportionally more scan points
    const totalW = heights.reduce((a, b) => a + Math.max(0.3, b), 0)
    const cdf    = []
    let cum = 0
    for (let k = 0; k < totalCells; k++) {
      cum += Math.max(0.3, heights[k]) / totalW
      cdf.push(cum)
    }

    function pickCell() {
      const r = srnd()
      for (let k = 0; k < totalCells - 1; k++) {
        if (r <= cdf[k]) return k
      }
      return totalCells - 1
    }

    for (let i = 0; i < p.pointCount; i++) {
      const bIdx = pickCell()
      const cx   = bIdx % numCells
      const cz   = Math.floor(bIdx / numCells)
      const bH   = heights[bIdx]

      const bx = (cx - numCells * 0.5 + 0.5) * cellSize
      const bz = (cz - numCells * 0.5 + 0.5) * cellSize

      let px, py, pz

      if (bH < 1.5) {
        px = bx + (srnd() - 0.5) * bldgW
        pz = bz + (srnd() - 0.5) * bldgW
        py = yCenter + srnd() * 0.5
      } else {
        const roll = srnd()
        if (roll < 0.55) {
          // ── Wall face (55%) — 70% snapped to scan ring ──────────────────
          const face  = Math.floor(srnd() * 4)
          const along = srnd() * bldgW
          let wallY
          if (srnd() < 0.70) {
            // Snap to a scan ring with small jitter
            const ring = Math.floor(srnd() * numRings)
            wallY = ring * ringSpacing + (srnd() - 0.5) * ringSpacing * 0.20
            wallY = Math.min(wallY, bH)
          } else {
            wallY = srnd() * bH
          }
          if      (face === 0) { px = bx - halfBldg;         pz = bz - halfBldg + along }
          else if (face === 1) { px = bx + halfBldg;         pz = bz - halfBldg + along }
          else if (face === 2) { px = bx - halfBldg + along; pz = bz - halfBldg }
          else                 { px = bx - halfBldg + along; pz = bz + halfBldg }
          py = yCenter + wallY
        } else if (roll < 0.80) {
          // ── Roof surface (25%) ───────────────────────────────────────────
          px = bx + (srnd() - 0.5) * bldgW
          pz = bz + (srnd() - 0.5) * bldgW
          py = yCenter + bH + srnd() * 0.2
        } else {
          // ── Ground / street (20%) ────────────────────────────────────────
          px = bx + (srnd() - 0.5) * cellSize
          pz = bz + (srnd() - 0.5) * cellSize
          py = yCenter + srnd() * 0.4
        }
      }

      // LiDAR scatter noise — mostly horizontal (preserves vertical structure)
      const ns = this.noise.fbm3(
        px * p.noiseScale,
        py * p.noiseScale,
        pz * p.noiseScale,
        3
      ) * p.noiseStrength

      px += ns * 1.8
      pz += ns * 1.8
      py += ns * 0.25

      positions[i * 3]     = px
      positions[i * 3 + 1] = py
      positions[i * 3 + 2] = pz

      driftOffsets[i * 3]     = srnd() * 100
      driftOffsets[i * 3 + 1] = srnd() * 100
      driftOffsets[i * 3 + 2] = srnd() * 100

      // Height + ring-pulsed coloring
      const frac     = Math.max(0, Math.min(1, (py - yCenter) / maxH))
      const ringFrac = (py - yCenter) / ringSpacing
      const ringPulse = 0.5 + 0.5 * Math.cos(ringFrac * Math.PI * 2)
      const brightness = 0.10 + frac * 0.72 + ringPulse * 0.18
      const c = dimColor.clone().lerp(baseColor, Math.min(1, brightness))
      colors[i * 3]     = c.r
      colors[i * 3 + 1] = c.g
      colors[i * 3 + 2] = c.b
    }
  }

  // ─── Image-driven cloud ────────────────────────────────────────────────────

  _buildImageDriven(positions, colors, driftOffsets, srnd, p) {
    const hasImage = p.imageData && p.imageWidth > 0 && p.imageHeight > 0

    if (!hasImage) {
      this._buildDefaultScanPattern(positions, colors, driftOffsets, srnd, p)
      return
    }

    // Pre-compute brightness per pixel
    const { imageData: data, imageWidth: imgW, imageHeight: imgH } = p
    const pixelCount = imgW * imgH
    const brightness = new Float32Array(pixelCount)
    for (let k = 0; k < pixelCount; k++) {
      const b = k * 4
      brightness[k] = (data[b] + data[b + 1] + data[b + 2]) / (255 * 3)
    }

    if (p.imageMapMode === 'density') {
      this._buildDensityMap(positions, colors, driftOffsets, srnd, p, brightness, imgW, imgH)
    } else {
      this._buildHeightMap(positions, colors, driftOffsets, srnd, p, brightness, imgW, imgH)
    }
  }

  _buildHeightMap(positions, colors, driftOffsets, srnd, p, brightness, imgW, imgH) {
    const { base: baseColor, dim: dimColor } = this._themeColors(p)
    const R    = p.cloudRadius
    const maxY = R * 0.8

    for (let i = 0; i < p.pointCount; i++) {
      const u = srnd()
      const v = srnd()

      const px = Math.min(imgW - 1, Math.floor(u * imgW))
      const py = Math.min(imgH - 1, Math.floor(v * imgH))
      const bright = brightness[py * imgW + px]

      const wx = (u - 0.5) * R * 2
      const wz = (v - 0.5) * R * 2
      const wy = (bright - 0.5) * maxY * 2

      // Noise as surface jitter — preserves topography shape
      const ns = this.noise.fbm3(wx * p.noiseScale, wy * p.noiseScale, wz * p.noiseScale, 3)
      positions[i * 3]     = wx + ns * p.noiseStrength * 0.6
      positions[i * 3 + 1] = wy + ns * p.noiseStrength * 2.0
      positions[i * 3 + 2] = wz + ns * p.noiseStrength * 0.6

      driftOffsets[i * 3]     = srnd() * 100
      driftOffsets[i * 3 + 1] = srnd() * 100
      driftOffsets[i * 3 + 2] = srnd() * 100

      const c = dimColor.clone().lerp(baseColor, bright)
      colors[i * 3]     = c.r
      colors[i * 3 + 1] = c.g
      colors[i * 3 + 2] = c.b
    }
  }

  _buildDensityMap(positions, colors, driftOffsets, srnd, p, brightness, imgW, imgH) {
    const { base: baseColor, dim: dimColor } = this._themeColors(p)
    const R = p.cloudRadius

    let maxBright = 0.001
    for (let k = 0; k < brightness.length; k++) {
      if (brightness[k] > maxBright) maxBright = brightness[k]
    }

    let placed = 0
    let attempts = 0
    const maxAttempts = p.pointCount * 20

    while (placed < p.pointCount && attempts < maxAttempts) {
      attempts++
      const u = srnd()
      const v = srnd()
      const px = Math.min(imgW - 1, Math.floor(u * imgW))
      const py = Math.min(imgH - 1, Math.floor(v * imgH))
      const bright = brightness[py * imgW + px]

      // Accept with probability proportional to brightness (min 5%)
      if (srnd() > Math.max(0.05, bright / maxBright)) continue

      const wx = (u - 0.5) * R * 2
      const wz = (v - 0.5) * R * 2
      const ns = this.noise.fbm3(wx * p.noiseScale, 0, wz * p.noiseScale, 3)
      const wy = ns * p.noiseStrength * R * 0.4

      const i = placed
      positions[i * 3]     = wx
      positions[i * 3 + 1] = wy
      positions[i * 3 + 2] = wz

      driftOffsets[i * 3]     = srnd() * 100
      driftOffsets[i * 3 + 1] = srnd() * 100
      driftOffsets[i * 3 + 2] = srnd() * 100

      const c = dimColor.clone().lerp(baseColor, 0.3 + bright * 0.7)
      colors[i * 3]     = c.r
      colors[i * 3 + 1] = c.g
      colors[i * 3 + 2] = c.b
      placed++
    }

    // Fill any unfilled slots (very dark image) with sphere scatter
    for (let i = placed; i < p.pointCount; i++) {
      const theta = Math.acos(2 * srnd() - 1)
      const phi   = srnd() * Math.PI * 2
      positions[i * 3]     = Math.sin(theta) * Math.cos(phi) * R * 0.3
      positions[i * 3 + 1] = Math.sin(theta) * Math.sin(phi) * R * 0.3
      positions[i * 3 + 2] = Math.cos(theta) * R * 0.3
      driftOffsets[i * 3]     = srnd() * 100
      driftOffsets[i * 3 + 1] = srnd() * 100
      driftOffsets[i * 3 + 2] = srnd() * 100
      colors[i * 3]     = dimColor.r
      colors[i * 3 + 1] = dimColor.g
      colors[i * 3 + 2] = dimColor.b
    }
  }

  // Default pattern shown in IMAGE mode before any image is loaded
  _buildDefaultScanPattern(positions, colors, driftOffsets, srnd, p) {
    const { base: baseColor, dim: dimColor } = this._themeColors(p)
    const R = p.cloudRadius

    for (let i = 0; i < p.pointCount; i++) {
      // 3D Lissajous figure — 7 and 11 loops (coprime for dense coverage)
      const t = (i / p.pointCount) * Math.PI * 2 * 7
      const u = (i / p.pointCount) * Math.PI * 2 * 11

      const wx = Math.sin(t) * R * 0.8
      const wy = Math.sin(u) * R * 0.5
      const wz = Math.cos(t * 1.3) * R * 0.8

      const ns = this.noise.fbm3(wx * p.noiseScale, wy * p.noiseScale, wz * p.noiseScale, 3)
      positions[i * 3]     = wx + ns * p.noiseStrength * 3
      positions[i * 3 + 1] = wy + ns * p.noiseStrength * 3
      positions[i * 3 + 2] = wz + ns * p.noiseStrength * 3

      driftOffsets[i * 3]     = srnd() * 100
      driftOffsets[i * 3 + 1] = srnd() * 100
      driftOffsets[i * 3 + 2] = srnd() * 100

      const t01 = (Math.sin(t) + 1) * 0.5
      const c = dimColor.clone().lerp(baseColor, t01)
      colors[i * 3]     = c.r
      colors[i * 3 + 1] = c.g
      colors[i * 3 + 2] = c.b
    }
  }

  // ─── Crystal lattice (BCC) cloud ──────────────────────────────────────────

  _buildCrystal(positions, colors, driftOffsets, srnd, p) {
    const { base: baseColor, dim: dimColor } = this._themeColors(p)
    const R = p.cloudRadius
    const N = p.pointCount

    // BCC lattice constant: sized so ~2× N sites land inside the sphere.
    // N_BCC_in_sphere ≈ 2 × (4/3)πR³ / a³  →  a = R × (8π/3N)^(1/3) × 0.78
    const a    = R * Math.pow(8 * Math.PI / (3 * N), 1 / 3) * 0.78
    const iMax = Math.ceil(R / a) + 1
    const R2   = R * R

    // Collect all BCC lattice sites within the sphere
    const lpx = [], lpy = [], lpz = []
    for (let ix = -iMax; ix <= iMax; ix++) {
      for (let iy = -iMax; iy <= iMax; iy++) {
        for (let iz = -iMax; iz <= iMax; iz++) {
          for (let b = 0; b < 2; b++) {
            const x = (ix + b * 0.5) * a
            const y = (iy + b * 0.5) * a
            const z = (iz + b * 0.5) * a
            if (x * x + y * y + z * z <= R2) {
              lpx.push(x); lpy.push(y); lpz.push(z)
            }
          }
        }
      }
    }

    const nL = lpx.length
    // Seeded Fisher-Yates shuffle — pick N random sites without repetition
    const idx = Array.from({ length: nL }, (_, i) => i)
    for (let i = nL - 1; i > 0; i--) {
      const j = Math.floor(srnd() * (i + 1))
      const tmp = idx[i]; idx[i] = idx[j]; idx[j] = tmp
    }

    for (let i = 0; i < N; i++) {
      const k  = idx[i % nL]
      const lx = lpx[k], ly = lpy[k], lz = lpz[k]

      // noiseStrength controls lattice disorder: 0 = perfect crystal, 1 = shattered
      const ns = this.noise.fbm3(
        lx * p.noiseScale + 7.3,
        ly * p.noiseScale + 7.3,
        lz * p.noiseScale + 7.3,
        3
      ) * p.noiseStrength * a * 0.5

      positions[i * 3]     = lx + ns
      positions[i * 3 + 1] = ly + ns * 0.7
      positions[i * 3 + 2] = lz + ns

      driftOffsets[i * 3]     = srnd() * 100
      driftOffsets[i * 3 + 1] = srnd() * 100
      driftOffsets[i * 3 + 2] = srnd() * 100

      // Color: radial shell fade + horizontal crystal-plane brightness pulse
      const dist       = Math.sqrt(lx * lx + ly * ly + lz * lz) / R
      const planePulse = 0.5 + 0.5 * Math.cos((ly / a) * Math.PI * 2)
      const brightness = 0.08 + dist * 0.35 + planePulse * 0.57
      const c = dimColor.clone().lerp(baseColor, Math.min(1, brightness))
      colors[i * 3]     = c.r
      colors[i * 3 + 1] = c.g
      colors[i * 3 + 2] = c.b
    }
  }

  // ─── Terrain heightfield scan ───────────────────────────────────────────

  _buildTerrain(positions, colors, driftOffsets, srnd, p) {
    const { base: baseColor, dim: dimColor } = this._themeColors(p)
    const R         = p.cloudRadius
    const numStrata = Math.max(2, Math.min(10, Math.round(p.terrainStrata ?? 5)))

    for (let i = 0; i < p.pointCount; i++) {
      const fx = (srnd() * 2 - 1) * R
      const fz = (srnd() * 2 - 1) * R

      // FBM height — noiseScale drives terrain frequency, noiseStrength drives relief
      const rawH  = this.noise.fbm3(fx * p.noiseScale, 0, fz * p.noiseScale, 5)
      const surfY = rawH * R * (0.30 + p.noiseStrength * 0.55)

      const roll = srnd()
      let wy, brightness

      if (roll < 0.62) {
        // Surface point — tight cluster around height field
        wy         = surfY + (srnd() - 0.5) * R * 0.018
        brightness = 0.45 + Math.max(0, rawH) * 0.55
      } else if (roll < 0.83) {
        // Geological strata — horizontal bands below the surface
        const si      = Math.floor(srnd() * numStrata)
        const strataY = -(si + 0.5) / numStrata * R * 0.65
        // Never let strata poke above the surface at this XZ column
        wy         = Math.min(strataY, surfY - R * 0.015)
        brightness = 0.08 + (numStrata - 1 - si) / (numStrata - 1) * 0.32
      } else {
        // Subsurface scatter — random depth beneath the surface
        wy         = surfY - srnd() * R * 0.45
        brightness = 0.02 + srnd() * 0.10
      }

      positions[i * 3]     = fx
      positions[i * 3 + 1] = wy
      positions[i * 3 + 2] = fz

      driftOffsets[i * 3]     = srnd() * 100
      driftOffsets[i * 3 + 1] = srnd() * 100
      driftOffsets[i * 3 + 2] = srnd() * 100

      const c = dimColor.clone().lerp(baseColor, Math.max(0, Math.min(1, brightness)))
      colors[i * 3]     = c.r
      colors[i * 3 + 1] = c.g
      colors[i * 3 + 2] = c.b
    }
  }

  // ─── IFS fractal — Sierpinski tetrahedron via chaos game ──────────────────

  _buildFractal(positions, colors, driftOffsets, srnd, p) {
    const { base: baseColor, dim: dimColor } = this._themeColors(p)
    const R = p.cloudRadius * 0.72

    // Regular tetrahedron vertices at circumradius R
    const V = [
      [  0,                         R,                       0 ],
      [  R * Math.sqrt(8 / 9),     -R / 3,                   0 ],
      [ -R * Math.sqrt(2 / 9),     -R / 3,  R * Math.sqrt(2 / 3) ],
      [ -R * Math.sqrt(2 / 9),     -R / 3, -R * Math.sqrt(2 / 3) ],
    ]

    // Chaos game warmup: 25 steps not recorded, so initial transient decays
    let cx = 0, cy = R * 0.25, cz = 0
    for (let w = 0; w < 25; w++) {
      const vi = Math.floor(srnd() * 4)
      cx = (cx + V[vi][0]) * 0.5
      cy = (cy + V[vi][1]) * 0.5
      cz = (cz + V[vi][2]) * 0.5
    }

    // Each vertex branch gets its own brightness — reveals 4-level self-similarity
    const vtxBrightness = [0.95, 0.65, 0.42, 0.22]

    for (let i = 0; i < p.pointCount; i++) {
      const vi = Math.floor(srnd() * 4)
      cx = (cx + V[vi][0]) * 0.5
      cy = (cy + V[vi][1]) * 0.5
      cz = (cz + V[vi][2]) * 0.5

      // noiseStrength blurs the fractal — 0 = crisp Sierpinski, 1 = cloud-like
      const ns = this.noise.fbm3(
        cx * p.noiseScale, cy * p.noiseScale, cz * p.noiseScale, 3
      ) * p.noiseStrength * R * 0.14

      positions[i * 3]     = cx + ns
      positions[i * 3 + 1] = cy + ns * 0.8
      positions[i * 3 + 2] = cz + ns

      driftOffsets[i * 3]     = srnd() * 100
      driftOffsets[i * 3 + 1] = srnd() * 100
      driftOffsets[i * 3 + 2] = srnd() * 100

      const c = dimColor.clone().lerp(baseColor, vtxBrightness[vi])
      colors[i * 3]     = c.r
      colors[i * 3 + 1] = c.g
      colors[i * 3 + 2] = c.b
    }
  }

  // ─── Galaxy / nebula cloud ─────────────────────────────────────────────────

  _buildGalaxy(positions, colors, driftOffsets, srnd, p) {
    const { base: baseColor, dim: dimColor } = this._themeColors(p)
    const R        = p.cloudRadius
    const numArms  = Math.max(1, Math.min(8, Math.round(p.galaxyArms ?? 3)))
    const tightness = 1.15   // logarithmic spiral winding

    for (let i = 0; i < p.pointCount; i++) {
      const roll = srnd()
      let px, py, pz, brightness

      if (roll < 0.15) {
        // ── Galactic core bulge ──────────────────────────────────────────
        const theta = Math.acos(2 * srnd() - 1)
        const phi   = srnd() * Math.PI * 2
        const r     = Math.pow(srnd(), 1.7) * R * 0.25
        px = r * Math.sin(theta) * Math.cos(phi)
        py = r * Math.sin(theta) * Math.sin(phi) * 0.42
        pz = r * Math.cos(theta)
        brightness = 0.50 + (1 - r / (R * 0.25)) * 0.50

      } else if (roll < 0.85) {
        // ── Logarithmic spiral arm ────────────────────────────────────────
        const armIdx  = Math.floor(srnd() * numArms)
        const armBase = (armIdx / numArms) * Math.PI * 2
        // Power-law radius: intermediate distances most common
        const r = (Math.pow(srnd(), 0.55) * 0.88 + 0.05) * R
        // Logarithmic spiral angle — winding increases inward
        const spiralAngle = armBase + tightness * Math.log(r / R * 8 + 1)
        const angSpread   = 0.10 + (r / R) * 0.10
        const dAngle      = (srnd() * 2 - 1) * angSpread
        px = r * Math.cos(spiralAngle + dAngle)
        pz = r * Math.sin(spiralAngle + dAngle)
        // Very thin disc, slightly thicker near core
        py = (srnd() * 2 - 1) * R * 0.035 * (1.2 - (r / R) * 0.85)

        // Arm turbulence — noiseStrength drives density wave ripple
        const ns = this.noise.fbm3(
          px * p.noiseScale, 0, pz * p.noiseScale, 3
        ) * p.noiseStrength * R * 0.07
        px += ns; pz += ns * 0.9

        brightness = 0.20 + (1 - r / R) * 0.68

      } else {
        // ── Stellar halo ─────────────────────────────────────────────────
        const theta = Math.acos(2 * srnd() - 1)
        const phi   = srnd() * Math.PI * 2
        const r     = Math.pow(srnd(), 0.45) * R
        px = r * Math.sin(theta) * Math.cos(phi)
        py = r * Math.sin(theta) * Math.sin(phi) * 0.38
        pz = r * Math.cos(theta)
        brightness = 0.02 + srnd() * 0.11
      }

      positions[i * 3]     = px
      positions[i * 3 + 1] = py
      positions[i * 3 + 2] = pz

      driftOffsets[i * 3]     = srnd() * 100
      driftOffsets[i * 3 + 1] = srnd() * 100
      driftOffsets[i * 3 + 2] = srnd() * 100

      const c = dimColor.clone().lerp(baseColor, Math.max(0, Math.min(1, brightness)))
      colors[i * 3]     = c.r
      colors[i * 3 + 1] = c.g
      colors[i * 3 + 2] = c.b
    }
  }

  // ─── Connections with animated pulse ──────────────────────────────────────

  _buildConnections() {
    if (this.lineSegments) {
      this.group.remove(this.lineSegments)
      this.lineSegments.geometry.dispose()
      this.lineSegments.material.dispose()
      this.lineSegments = null
      this._lineUniforms = null
    }

    this._adjacency = null

    if (!this.params.connectionsEnabled) {
      this.edgeCount = 0
      return
    }

    const p        = this.params
    const pos      = this.pointsMesh.geometry.attributes.position.array
    const n        = this.pointCount
    const maxDist  = p.connectionDist
    const maxDist2 = maxDist * maxDist

    // Spatial hash grid — O(N) average vs O(N²) brute force
    const cellSize = maxDist
    const grid = new Map()
    for (let i = 0; i < n; i++) {
      const k = `${Math.floor(pos[i*3]/cellSize)},${Math.floor(pos[i*3+1]/cellSize)},${Math.floor(pos[i*3+2]/cellSize)}`
      if (!grid.has(k)) grid.set(k, [])
      grid.get(k).push(i)
    }

    const linePositions = []
    const adjacency     = Array.from({ length: n }, () => [])
    let   edgeIndex     = 0

    for (let i = 0; i < n; i++) {
      const ix = pos[i*3], iy = pos[i*3+1], iz = pos[i*3+2]
      const cx = Math.floor(ix/cellSize), cy = Math.floor(iy/cellSize), cz = Math.floor(iz/cellSize)
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            const cell = grid.get(`${cx+dx},${cy+dy},${cz+dz}`)
            if (!cell) continue
            for (const j of cell) {
              if (j <= i) continue
              const ddx = pos[j*3]-ix, ddy = pos[j*3+1]-iy, ddz = pos[j*3+2]-iz
              if (ddx*ddx + ddy*ddy + ddz*ddz < maxDist2) {
                linePositions.push(ix, iy, iz, pos[j*3], pos[j*3+1], pos[j*3+2])
                adjacency[i].push(j)
                adjacency[j].push(i)
                edgeIndex++
              }
            }
          }
        }
      }
    }

    this.edgeCount  = edgeIndex
    this._adjacency = adjacency

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(linePositions), 3))

    const theme = COLOR_THEMES[p.colorTheme] || COLOR_THEMES.cityscan
    this._lineUniforms = {
      uOpacity: { value: p.lineOpacity },
      uColor:   { value: new THREE.Color(theme.base) },
    }

    const mat = new THREE.ShaderMaterial({
      uniforms:       this._lineUniforms,
      vertexShader:   LINE_VERT,
      fragmentShader: LINE_FRAG,
      transparent:    true,
      depthWrite:     false,
    })

    this.lineSegments = new THREE.LineSegments(geo, mat)
    this.group.add(this.lineSegments)
  }

  // ─── Per-frame update ─────────────────────────────────────────────────────

  update(time) {
    const p   = this.params
    const pos  = this.pointsMesh.geometry.attributes.position
    const arr  = pos.array
    const base = this.basePositions
    const off  = this.driftOffsets

    for (let i = 0; i < this.pointCount; i++) {
      const ox = off[i * 3], oy = off[i * 3 + 1], oz = off[i * 3 + 2]
      const t  = time * p.driftSpeed

      if (p.driftEnabled) {
        const dx = this.noise.noise3(ox + t, oy,     oz    ) * p.driftAmp
        const dy = this.noise.noise3(ox,     oy + t, oz    ) * p.driftAmp
        const dz = this.noise.noise3(ox,     oy,     oz + t) * p.driftAmp
        arr[i * 3]     = base[i * 3]     + dx
        arr[i * 3 + 1] = base[i * 3 + 1] + dy
        arr[i * 3 + 2] = base[i * 3 + 2] + dz
      } else {
        arr[i * 3]     = base[i * 3]
        arr[i * 3 + 1] = base[i * 3 + 1]
        arr[i * 3 + 2] = base[i * 3 + 2]
      }
    }

    pos.needsUpdate = true

    if (this.lineSegments && p.connectionsEnabled) {
      this._updateConnectionPositions(arr)
    }
  }

  _updateConnectionPositions(currentPos) {
    // O(E) update using stored adjacency — topology is fixed to base positions,
    // only vertex coordinates are refreshed each frame.
    const lineArr = this.lineSegments.geometry.attributes.position.array
    let vi = 0
    const n = this.pointCount
    for (let i = 0; i < n; i++) {
      for (const j of this._adjacency[i]) {
        if (j > i) {
          lineArr[vi++] = currentPos[i * 3]
          lineArr[vi++] = currentPos[i * 3 + 1]
          lineArr[vi++] = currentPos[i * 3 + 2]
          lineArr[vi++] = currentPos[j * 3]
          lineArr[vi++] = currentPos[j * 3 + 1]
          lineArr[vi++] = currentPos[j * 3 + 2]
        }
      }
    }
    this.lineSegments.geometry.attributes.position.needsUpdate = true
  }

  // ─── Hover with 3-hop cascade ─────────────────────────────────────────────

  setHovered(index) {
    if (this.hoveredIndex === index) return
    this.hoveredIndex = index

    const colors = this.pointsMesh.geometry.attributes.color
    const arr    = colors.array
    const n      = this.pointCount
    const p      = this.params
    const theme  = COLOR_THEMES[p.colorTheme] || COLOR_THEMES.cityscan

    const hoverColor = new THREE.Color(theme.hover)
    const hop1Color  = new THREE.Color(theme.conn)
    const hop2Color  = new THREE.Color(theme.conn).lerp(new THREE.Color(theme.dim), 0.45)
    const hop3Color  = new THREE.Color(theme.conn).lerp(new THREE.Color(theme.dim), 0.72)
    const restColor  = new THREE.Color(theme.dim).lerp(new THREE.Color(theme.base), 0.08)
    const baseColor  = new THREE.Color(theme.base).lerp(new THREE.Color(theme.dim), 0.5)

    // BFS up to 3 hops using adjacency list
    // hopMap: pointIndex → hop distance (1, 2, or 3)
    const hopMap = new Map()

    if (index >= 0 && p.connectionsEnabled && this._adjacency) {
      const bfs = (seeds, hop) => {
        const next = []
        for (const seed of seeds) {
          for (const nb of this._adjacency[seed]) {
            if (nb !== index && !hopMap.has(nb)) {
              hopMap.set(nb, hop)
              next.push(nb)
            }
          }
        }
        return next
      }
      const h1 = bfs([index], 1)
      const h2 = bfs(h1, 2)
      bfs(h2, 3)
    }

    for (let i = 0; i < n; i++) {
      let c
      if (i === index) {
        c = hoverColor
      } else if (hopMap.has(i)) {
        const hop = hopMap.get(i)
        if      (hop === 1) c = hop1Color
        else if (hop === 2) c = hop2Color
        else                c = hop3Color
      } else {
        c = index >= 0 ? restColor : baseColor
      }
      arr[i * 3]     = c.r
      arr[i * 3 + 1] = c.g
      arr[i * 3 + 2] = c.b
    }

    colors.needsUpdate = true
  }

  // ─── Live param updates ───────────────────────────────────────────────────

  setRendererScale(scale) {
    this._rendererScale = scale
    if (this.pointsMesh) {
      this.pointsMesh.material.uniforms.uScale.value = scale
    }
  }

  applyParam(key, value) {
    this.params[key] = value
    switch (key) {
      case 'pointSize':
        this.pointsMesh.material.uniforms.uSize.value = value
        break
      case 'lineOpacity':
        if (this._lineUniforms) this._lineUniforms.uOpacity.value = value
        break
      case 'connectionDist':
      case 'connectionsEnabled':
        this._buildConnections()
        break
    }
  }

  applyTheme(themeName) {
    this.params.colorTheme = themeName
    const theme = COLOR_THEMES[themeName] || COLOR_THEMES.cityscan
    if (this._lineUniforms) {
      this._lineUniforms.uColor.value.setHex(theme.base)
    }
  }

  rebuild() {
    this._build()
  }

  _disposeAll() {
    if (this.pointsMesh) {
      this.group.remove(this.pointsMesh)
      this.pointsMesh.geometry.dispose()
      this.pointsMesh.material.dispose()
      this.pointsMesh = null
    }
    if (this.lineSegments) {
      this.group.remove(this.lineSegments)
      this.lineSegments.geometry.dispose()
      this.lineSegments.material.dispose()
      this.lineSegments = null
      this._lineUniforms = null
    }
    this._adjacency = null
  }

  // Full teardown including the scene group — call this before replacing the instance
  dispose() {
    this._disposeAll()
    this.scene.remove(this.group)
  }

  get stats() {
    return { points: this.pointCount, edges: this.edgeCount }
  }
}
