/**
 * Seeded 3D Perlin noise implementation.
 * Based on Ken Perlin's improved noise algorithm.
 */

function buildPermutation(seed) {
  // Simple seeded PRNG (mulberry32)
  let s = seed >>> 0
  function rand() {
    s |= 0; s = s + 0x6D2B79F5 | 0
    let t = Math.imul(s ^ s >>> 15, 1 | s)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }

  const p = new Uint8Array(256)
  for (let i = 0; i < 256; i++) p[i] = i
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]]
  }
  // Double to avoid modulo
  const perm = new Uint8Array(512)
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255]
  return perm
}

function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10) }
function lerp(a, b, t) { return a + t * (b - a) }

function grad3(hash, x, y, z) {
  const h = hash & 15
  const u = h < 8 ? x : y
  const v = h < 4 ? y : h === 12 || h === 14 ? x : z
  return ((h & 1) ? -u : u) + ((h & 2) ? -v : v)
}

export class PerlinNoise {
  constructor(seed = 0) {
    this.perm = buildPermutation(seed)
  }

  reseed(seed) {
    this.perm = buildPermutation(seed)
  }

  /** Returns a value in approximately [-1, 1] */
  noise3(x, y, z) {
    const perm = this.perm

    const X = Math.floor(x) & 255
    const Y = Math.floor(y) & 255
    const Z = Math.floor(z) & 255

    x -= Math.floor(x)
    y -= Math.floor(y)
    z -= Math.floor(z)

    const u = fade(x)
    const v = fade(y)
    const w = fade(z)

    const A  = perm[X]   + Y
    const AA = perm[A]   + Z
    const AB = perm[A+1] + Z
    const B  = perm[X+1] + Y
    const BA = perm[B]   + Z
    const BB = perm[B+1] + Z

    return lerp(
      lerp(
        lerp(grad3(perm[AA],   x,   y,   z),
             grad3(perm[BA],   x-1, y,   z), u),
        lerp(grad3(perm[AB],   x,   y-1, z),
             grad3(perm[BB],   x-1, y-1, z), u), v),
      lerp(
        lerp(grad3(perm[AA+1], x,   y,   z-1),
             grad3(perm[BA+1], x-1, y,   z-1), u),
        lerp(grad3(perm[AB+1], x,   y-1, z-1),
             grad3(perm[BB+1], x-1, y-1, z-1), u), v), w)
  }

  /** Fractal Brownian Motion — sums multiple octaves for organic look */
  fbm3(x, y, z, octaves = 4, lacunarity = 2.0, gain = 0.5) {
    let value = 0
    let amplitude = 0.5
    let frequency = 1.0
    for (let i = 0; i < octaves; i++) {
      value += amplitude * this.noise3(x * frequency, y * frequency, z * frequency)
      amplitude *= gain
      frequency *= lacunarity
    }
    return value
  }
}
