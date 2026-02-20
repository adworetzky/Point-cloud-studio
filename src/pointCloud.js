import * as THREE from 'three'
import { PerlinNoise } from './noise.js'

// ─── Shaders for circular points ────────────────────────────────────────────

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

  // ─── Organic (default) cloud ────────────────────────────────────────────

  _buildOrganic(positions, colors, driftOffsets, srnd, p) {
    const baseColor = new THREE.Color(0x00ffe0)
    const dimColor  = new THREE.Color(0x004d45)

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

  // ─── Structural / architectural city-scan cloud ─────────────────────────

  _buildStructural(positions, colors, driftOffsets, srnd, p) {
    const baseColor = new THREE.Color(0x00ffe0)
    const dimColor  = new THREE.Color(0x004d45)

    // Grid of building footprints filling the cloud radius
    const numCells  = Math.max(3, Math.round(p.cloudRadius / 8))
    const totalSize = p.cloudRadius * 1.6          // total city footprint
    const cellSize  = totalSize / numCells
    const streetGap = cellSize * 0.22              // gap between buildings (street)
    const bldgW     = cellSize - streetGap         // building footprint width
    const halfBldg  = bldgW * 0.5

    // Pre-generate building heights with seeded RNG
    const totalCells = numCells * numCells
    const heights    = new Float32Array(totalCells)
    let   maxH       = 0.001

    for (let k = 0; k < totalCells; k++) {
      const u = srnd()
      // ~28% chance of a very flat roof/plaza; rest graduated toward towers
      const h = u < 0.28
        ? srnd() * p.cloudRadius * 0.07
        : Math.pow(srnd(), 0.45) * p.cloudRadius * 0.85
      heights[k] = h
      if (h > maxH) maxH = h
    }

    // Vertically center the cityscape: push down so mid-height aligns at y=0
    const yCenter = -maxH * 0.35

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

      // Building centre in world space
      const bx = (cx - numCells * 0.5 + 0.5) * cellSize
      const bz = (cz - numCells * 0.5 + 0.5) * cellSize

      let px, py, pz

      if (bH < 1.5) {
        // Flat / plaza — scatter on ground level
        px = bx + (srnd() - 0.5) * bldgW
        pz = bz + (srnd() - 0.5) * bldgW
        py = yCenter + srnd() * 0.5
      } else {
        const roll = srnd()
        if (roll < 0.55) {
          // ── Wall face (55%) ──────────────────────────────────────────────
          const face  = Math.floor(srnd() * 4)
          const along = srnd() * bldgW
          const wallY = srnd() * bH
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
          // Allow points slightly outside building bounds to populate streets
          px = bx + (srnd() - 0.5) * cellSize
          pz = bz + (srnd() - 0.5) * cellSize
          py = yCenter + srnd() * 0.4
        }
      }

      // Apply noise as LiDAR scan scatter:
      // mostly horizontal (preserves vertical building structure)
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

      // Height-based coloring: dim at street level, bright at rooftops
      const frac = Math.max(0, Math.min(1, (py - yCenter) / maxH))
      const c    = dimColor.clone().lerp(baseColor, 0.15 + frac * 0.85)
      colors[i * 3]     = c.r
      colors[i * 3 + 1] = c.g
      colors[i * 3 + 2] = c.b
    }
  }

  // ─── Connections ────────────────────────────────────────────────────────

  _buildConnections() {
    if (this.lineSegments) {
      this.scene.remove(this.lineSegments)
      this.lineSegments.geometry.dispose()
      this.lineSegments.material.dispose()
      this.lineSegments = null
    }

    if (!this.params.connectionsEnabled) {
      this.edgeCount = 0
      return
    }

    const p       = this.params
    const pos     = this.pointsMesh.geometry.attributes.position.array
    const n       = this.pointCount
    const maxDist2 = p.connectionDist * p.connectionDist

    const linePositions = []

    for (let i = 0; i < n; i++) {
      const ix = pos[i * 3], iy = pos[i * 3 + 1], iz = pos[i * 3 + 2]
      for (let j = i + 1; j < n; j++) {
        const dx = pos[j * 3] - ix
        const dy = pos[j * 3 + 1] - iy
        const dz = pos[j * 3 + 2] - iz
        if (dx * dx + dy * dy + dz * dz < maxDist2) {
          linePositions.push(ix, iy, iz, pos[j*3], pos[j*3+1], pos[j*3+2])
        }
      }
    }

    this.edgeCount = linePositions.length / 6

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(linePositions), 3))

    const mat = new THREE.LineBasicMaterial({
      color: 0x00ffe0,
      transparent: true,
      opacity: p.lineOpacity,
      depthWrite: false,
    })

    this.lineSegments = new THREE.LineSegments(geo, mat)
    this.scene.add(this.lineSegments)
  }

  // ─── Per-frame update ───────────────────────────────────────────────────

  /** Called every frame. time is elapsed seconds. */
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

  // ─── Hover ──────────────────────────────────────────────────────────────

  /** Update hovered point highlight. index = -1 to clear. */
  setHovered(index) {
    if (this.hoveredIndex === index) return
    this.hoveredIndex = index

    const colors = this.pointsMesh.geometry.attributes.color
    const arr    = colors.array
    const n      = this.pointCount

    const baseColor  = new THREE.Color(0x00ffe0)
    const dimColor   = new THREE.Color(0x004d45)
    const hoverColor = new THREE.Color(0xffffff)
    const connColor  = new THREE.Color(0x80fff0)

    const connectedSet = new Set()
    if (index >= 0 && this.params.connectionsEnabled) {
      const pos      = this.pointsMesh.geometry.attributes.position.array
      const maxDist2 = this.params.connectionDist * this.params.connectionDist
      const ix = pos[index * 3], iy = pos[index * 3 + 1], iz = pos[index * 3 + 2]
      for (let j = 0; j < n; j++) {
        if (j === index) continue
        const dx = pos[j * 3] - ix
        const dy = pos[j * 3 + 1] - iy
        const dz = pos[j * 3 + 2] - iz
        if (dx*dx + dy*dy + dz*dz < maxDist2) connectedSet.add(j)
      }
    }

    for (let i = 0; i < n; i++) {
      let c
      if (i === index) {
        c = hoverColor
      } else if (connectedSet.has(i)) {
        c = connColor
      } else {
        c = baseColor.clone().lerp(dimColor, 0.5)
      }
      arr[i * 3]     = c.r
      arr[i * 3 + 1] = c.g
      arr[i * 3 + 2] = c.b
    }

    colors.needsUpdate = true
  }

  // ─── Live param updates ─────────────────────────────────────────────────

  /** Update the renderer's physical half-height for correct size attenuation. */
  setRendererScale(scale) {
    this._rendererScale = scale
    if (this.pointsMesh) {
      this.pointsMesh.material.uniforms.uScale.value = scale
    }
  }

  /** Sync a single param without full rebuild. */
  applyParam(key, value) {
    this.params[key] = value
    switch (key) {
      case 'pointSize':
        this.pointsMesh.material.uniforms.uSize.value = value
        break
      case 'lineOpacity':
        if (this.lineSegments) this.lineSegments.material.opacity = value
        break
      case 'connectionDist':
      case 'connectionsEnabled':
        this._buildConnections()
        break
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
    }
  }

  get stats() {
    return { points: this.pointCount, edges: this.edgeCount }
  }
}
