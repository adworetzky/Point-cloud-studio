# Point Cloud Studio — Feature Backlog

Status: `[ ]` pending · `[~]` in progress · `[x]` done

---

## New Cloud Styles

- [ ] **DNA Helix** — Two intertwined helices with base-pair connectors. `noiseStrength` controls degree of unwinding. Color dims from core out.
- [ ] **Torus Knot** — Parametric `(p, q)` knot wrapped on a torus surface. `p`/`q` sliders replace `galaxyArms`/`terrainStrata` in the style-specific panel.
- [ ] **Boids / Murmuration** — Flocking simulation (separation, alignment, cohesion) run to equilibrium, then positions baked as the point cloud snapshot.
- [ ] **Mandelbulb** — 3D escape-time fractal. `noiseScale` → bailout radius; `noiseStrength` → power. Points placed on the escape-time isosurface.
- [ ] **Voronoi Shell** — Points on 3D Voronoi cell boundaries. Geometric, faceted aesthetic; `noiseStrength` controls irregularity of seed placement.
- [ ] **Accretion Disk** — Flattened galaxy variant with a relativistic lensing warp near the gravitational center. Core brightens sharply.

---

## Interaction Upgrades

- [ ] **Gravity cursor** — Hold `G` to attract nearby points toward mouse; release repels. Direct per-frame position perturbation, no rebuild.
- [ ] **Explode on click** — Click a point to trigger a radial burst; points animate outward then spring back (simple damped physics, no rebuild).
- [ ] **Lasso select** — Draw a freehand screen-space region to select a point subset; isolate or highlight them.
- [ ] **Point annotation** — Click to pin a persistent world-space label at a point (`PT 0042 — [1.2, −4.5, 7.8]`), overlaid in screen space via CSS3D or canvas overlay.

---

## Animation / Audio

- [ ] **Audio-reactive mode** — Web Audio API mic FFT drives `driftAmp` or `noiseStrength` live. Bass bin → displacement magnitude; treble → color brightness pulse. Toggle `[A]`.
- [ ] **Morph interpolation** — Generate rest positions for two different styles, GLSL-lerp over N seconds. `[M]` key triggers morph; duration slider in UI.
- [ ] **Particle trails** — Each drifting point leaves a fading ghost trail stored in a ring buffer of N past positions, rendered as alpha-faded line segments behind it.
- [ ] **Animation recorder** — `MediaRecorder` captures the canvas as a WebM clip. Record/stop button in Actions section; auto-downloads on stop.

---

## Visual / Rendering

- [ ] **Bloom post-processing** — Three.js `UnrealBloomPass` via `EffectComposer`. Single toggle + strength/radius sliders. High aesthetic impact for the cyberpunk look.
- [ ] **Depth of field** — `BokehPass`: blurs points far from a focal plane. Focus distance controlled by a slider or by holding `F` + scrolling.
- [ ] **Color-by-velocity** — During drift, points whose displacement exceeds a threshold shift toward white; slow-moving ones dim. Live, no rebuild. Works on top of any color mode.
- [ ] **Scanline / CRT overlay** — CSS or shader post-pass with horizontal scan bands and slight barrel distortion. Single toggle in the UI.
- [ ] **Orthographic camera mode** — Toggle perspective ↔ orthographic; useful for blueprint-style elevation views. `[O]` key.
- [ ] **Delaunay surface** — Compute 3D Delaunay triangulation and toggle between point cloud and mesh wireframe (or solid with low alpha). `[T]` key.

---

## Positional Hue Shift  *(new — drafted below)*

- [ ] **Dynamic positional coloring** — Post-build CPU pass rotates point hue based on a chosen position axis. Works across all cloud styles universally. See full spec below.

---

## Export / Sharing

- [ ] **PLY / XYZ export** — Download current point positions as a real point cloud file (PLY binary or ASCII XYZ). Importable in Blender, CloudCompare, MeshLab. One button in Actions.
- [ ] **SVG export** — Orthographic projection of current view → vector SVG with `z`-depth ordering. Good for printing/plotting.
- [ ] **Embed snippet** — "Copy iframe" button generates a self-contained URL with all params for embedding the scene on any webpage.
- [ ] **Named presets** — Save up to 8 named configurations in `localStorage`; load from a preset picker in the sidebar. Includes export/import as JSON.

---

## UX / Polish

- [ ] **Undo / redo** — Stack of param snapshots (max depth 20); `Ctrl+Z` / `Ctrl+Y` walks through changes without rebuild if possible, with rebuild if geometry params changed.
- [ ] **VR mode** — WebXR `ImmersiveVR` session; Three.js renderer flag + controller ray interactors. `[V]` key or button.
- [ ] **Navigation cube** — Corner gizmo showing orientation axes (X/Y/Z faces); click a face to snap camera to top/front/side view.
- [ ] **Split compare** — Two canvases side by side with independent params, shared color theme. Drag the divider.

---
---

## Feature Draft: Positional Hue Shift

### Overview

Currently, every cloud style bakes point colors as a **brightness-only gradient** between `base` and `dim` (the two poles of the current color theme). The hue never changes within a single render — all points share the same hue family.

**Positional Hue Shift** adds a second color dimension: the hue of each point rotates based on where it sits along a chosen spatial axis. A terrain point high above the base gets a different hue than one at ground level. A galaxy point far from the center drifts to a complementary hue. The effect works universally across all 10 cloud styles because it runs as a **post-build pass** after each style's geometry builder fills `positions[]` and `colors[]`.

### How it interacts with the existing system

- The style builder runs first, populating `positions[]` and `colors[]` exactly as today.
- After the builder returns, if `params.colorMode === 'positional'`, a universal post-pass reads `positions[]`, computes a normalized `t ∈ [0, 1]` per point based on the chosen axis, then rotates each point's already-computed color in HSL space by `t × hueRange` degrees plus a `hueOffset` base rotation.
- Result: brightness variation from the style builder is **preserved** (a dim point stays dim), but hue now also varies by position.
- The existing hover BFS cascade (white → conn → dim) still overrides colors at hover time, as today.
- Connections keep the theme's `conn` uniform color (no change to line shader).

### New params

| Param | Type | Default | Rebuild? | Description |
|---|---|---|---|---|
| `colorMode` | `'theme' \| 'positional'` | `'theme'` | rebuild | Enables positional hue shift post-pass |
| `hueAxis` | `'y' \| 'radial' \| 'x' \| 'z'` | `'y'` | rebuild | Axis used to derive per-point `t` |
| `hueRange` | `0–360` | `120` | rebuild | Degrees of hue sweep across the axis range |
| `hueOffset` | `0–360` | `0` | rebuild | Rotates the entire palette without changing the sweep |

All four params are URL-shareable.

### Per-style natural axis suggestions (informational, not enforced)

| Style | Natural axis | Why |
|---|---|---|
| Terrain | `y` | Height above ground → geological strata colors |
| Structural | `y` | Floor level → warm rooftop vs cool ground scan |
| Galaxy | `radial` | Distance from core → core is different color than arms |
| Organic | `y` or `radial` | Radial displacement reads like depth vs surface |
| Crystal | `y` | Lattice plane layers each get a distinct hue band |
| Fractal | `radial` | Self-similar shells each at a different hue |
| Reaction-Diffusion | `y` | Reaction front depth |
| Fluid | `x` | Streamline side-to-side spread |
| L-System | `y` | Root (base hue) → canopy (shifted hue) naturally matches botanical gradient |
| Image | `y` | Height map → hue matches the topographic elevation |

The axis is just a UI suggestion — users can choose any axis for any style.

### Algorithm (CPU post-pass)

```javascript
// Called in _build() after the style builder returns, before geometry upload:
_applyPositionalHue(positions, colors, count, p) {
  if (p.colorMode !== 'positional') return

  // 1. Compute per-point scalar based on chosen axis
  const values = new Float32Array(count)
  let min = Infinity, max = -Infinity
  for (let i = 0; i < count; i++) {
    let v
    if (p.hueAxis === 'radial') {
      const x = positions[i*3], y = positions[i*3+1], z = positions[i*3+2]
      v = Math.sqrt(x*x + y*y + z*z)
    } else {
      const axisIdx = { x: 0, y: 1, z: 2 }[p.hueAxis] ?? 1
      v = positions[i*3 + axisIdx]
    }
    values[i] = v
    if (v < min) min = v
    if (v > max) max = v
  }
  const span = max - min || 1

  // 2. Rotate hue per point
  const tmp = new THREE.Color()
  for (let i = 0; i < count; i++) {
    const t = (values[i] - min) / span            // 0 → 1 across axis range
    tmp.setRGB(colors[i*3], colors[i*3+1], colors[i*3+2])
    const hsl = { h: 0, s: 0, l: 0 }
    tmp.getHSL(hsl)
    hsl.h = ((hsl.h + p.hueOffset / 360 + t * p.hueRange / 360) % 1 + 1) % 1
    tmp.setHSL(hsl.h, hsl.s, hsl.l)
    colors[i*3]     = tmp.r
    colors[i*3 + 1] = tmp.g
    colors[i*3 + 2] = tmp.b
  }
}
```

### UI placement

Inside the existing **COLOR THEME** row area, add:

```
COLOR MODE    [ THEME ▾ ]          ← dropdown: Theme | Positional
HUE AXIS      [ Y ▾ ]              ← dropdown: Y | Radial | X | Z   (visible if Positional)
HUE RANGE     ────────●────  120°  ← slider 0–360                   (visible if Positional)
HUE OFFSET    ────●──────── 0°    ← slider 0–360                   (visible if Positional)
```

All three Positional sub-controls hide when `colorMode === 'theme'` (same pattern as the Galaxy arms / Terrain strata style-specific panel).

### Future extension: live shader version

Once the CPU post-pass version ships, a follow-up could move the hue shift into the vertex shader for live updates during drift (so points recolor as they move). This requires:
- Passing `uHueRange`, `uHueOffset`, `uAxisMin`, `uAxisMax` as uniforms.
- Performing HSL conversion in GLSL (straightforward with standard hsl2rgb).
- Passing an `aAxisValue` float attribute per point (precomputed at build time for `radial`, or just reading `position.y`).
