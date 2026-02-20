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
    this.scene.add(this.pointsMesh)

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

  // ─── Connections with animated pulse ──────────────────────────────────────

  _buildConnections() {
    if (this.lineSegments) {
      this.scene.remove(this.lineSegments)
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

    const p       = this.params
    const pos     = this.pointsMesh.geometry.attributes.position.array
    const n       = this.pointCount
    const maxDist2 = p.connectionDist * p.connectionDist

    const linePositions = []

    // Build adjacency list simultaneously
    const adjacency = Array.from({ length: n }, () => [])

    let edgeIndex = 0

    for (let i = 0; i < n; i++) {
      const ix = pos[i * 3], iy = pos[i * 3 + 1], iz = pos[i * 3 + 2]
      for (let j = i + 1; j < n; j++) {
        const dx = pos[j * 3] - ix
        const dy = pos[j * 3 + 1] - iy
        const dz = pos[j * 3 + 2] - iz
        if (dx * dx + dy * dy + dz * dz < maxDist2) {
          linePositions.push(ix, iy, iz, pos[j*3], pos[j*3+1], pos[j*3+2])
          adjacency[i].push(j)
          adjacency[j].push(i)
          edgeIndex++
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
    this.scene.add(this.lineSegments)
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
    const p        = this.params
    const n        = this.pointCount
    const maxDist2 = p.connectionDist * p.connectionDist
    const lineArr  = this.lineSegments.geometry.attributes.position.array
    let vi = 0

    for (let i = 0; i < n; i++) {
      const ix = currentPos[i * 3], iy = currentPos[i * 3 + 1], iz = currentPos[i * 3 + 2]
      for (let j = i + 1; j < n; j++) {
        const dx = currentPos[j * 3] - ix
        const dy = currentPos[j * 3 + 1] - iy
        const dz = currentPos[j * 3 + 2] - iz
        if (dx * dx + dy * dy + dz * dz < maxDist2) {
          if (vi + 5 < lineArr.length) {
            lineArr[vi++] = ix
            lineArr[vi++] = iy
            lineArr[vi++] = iz
            lineArr[vi++] = currentPos[j * 3]
            lineArr[vi++] = currentPos[j * 3 + 1]
            lineArr[vi++] = currentPos[j * 3 + 2]
          }
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
      this.scene.remove(this.pointsMesh)
      this.pointsMesh.geometry.dispose()
      this.pointsMesh.material.dispose()
      this.pointsMesh = null
    }
    if (this.lineSegments) {
      this.scene.remove(this.lineSegments)
      this.lineSegments.geometry.dispose()
      this.lineSegments.material.dispose()
      this.lineSegments = null
      this._lineUniforms = null
    }
    this._adjacency = null
  }

  get stats() {
    return { points: this.pointCount, edges: this.edgeCount }
  }
}
