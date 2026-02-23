# Point Cloud Studio

Interactive 3D point cloud visualizer built with Three.js + Vite. Cyberpunk terminal aesthetic. Deployed to GitHub Pages.

## Commands

```bash
npm run dev       # Dev server (http://localhost:5173/Point-cloud-studio/)
npm run build     # Production build → dist/
npm run preview   # Preview production build locally
```

No test suite. Visual verification only — run `npm run dev` and interact in browser.

## Architecture

```
index.html         # Sidebar UI + canvas. All control IDs live here.
src/
  main.js          # Scene setup, params object, animation loop, raycasting, UI wiring,
                   #   post-processing, gravity cursor, audio, presets, export handlers
  pointCloud.js    # All Three.js geometry, shaders, generation algorithms, per-frame update,
                   #   gravity/explode physics, positional hue shift post-pass
  ui.js            # Pure DOM binder — reads HTML IDs, calls back via onRebuild/onParamChange
  noise.js         # Seeded Perlin noise + FBM (Fractal Brownian Motion)
  style.css        # Cyberpunk terminal theme, CRT overlay, preset list
vite.config.js     # base: '/Point-cloud-studio/' for GitHub Pages
```

## Key Patterns

**Params object** (`main.js`): Single source of truth for all state. Passed by reference to `PointCloud` and `initUI`.

**Rebuild vs. live params** — critical distinction:
- **Rebuild** (destroys + recreates geometry): `cloudStyle`, `pointCount`, `cloudRadius`, `noiseScale`, `noiseStrength`, `seed`, `colorMode`, `hueAxis`, `hueRange`, `hueOffset`
- **Live** (no rebuild, uniform/material update only): `pointSize`, `lineOpacity`, `lineWidth`, `driftSpeed`, `driftAmp`, `driftEnabled`
- **Reconnect** (rebuild edges only): `connectionsEnabled`, `connectionDist`

**Cloud styles** (`params.cloudStyle`):
- `'organic'` — spherical random distribution + Perlin FBM displacement
- `'structural'` — procedural cityscape with CDF-weighted building placement + LiDAR scan ring banding
- `'image'` — image upload drives height map or density map; falls back to Lissajous pattern if no image loaded
- `'crystal'` — BCC crystal lattice
- `'terrain'` — FBM heightfield with strata banding
- `'fractal'` — Sierpinski tetrahedron IFS
- `'galaxy'` — logarithmic spiral galaxy with configurable arms
- `'reactiondiffusion'` — Gray-Scott reaction-diffusion surface
- `'fluid'` — curl-noise fluid streamlines
- `'lsystem'` — 3D recursive branching tree

**Color themes** (`params.colorTheme`): `'cityscan'` (teal), `'cosmic'` (purple), `'bio'` (green), `'infrared'` (heat), `'mono'` (monochrome), `'sunset'` (pink). Theme changes update renderer clear color, fog, line shader uniform, and trigger rebuild to bake new point colors.

**Color modes** (`params.colorMode`):
- `'theme'` — default; each style bakes brightness-only gradients using the active theme
- `'positional'` — runs `_applyPositionalHue()` post-pass after any style builder; rotates each point's hue based on position along `params.hueAxis` (`'y'`, `'radial'`, `'x'`, `'z'`). `hueRange` (0–360°) sets sweep width; `hueOffset` rotates the palette. Preserves brightness from the style builder. All four params are URL-shareable and trigger rebuild.

**Image mode** (`params.imageData/imageWidth/imageHeight/imageMapMode`): Raw `Uint8ClampedArray` from offscreen canvas (max 256×256). Height map = Y from brightness; density map = rejection sampling clusters points in bright areas.

**Seeded RNG**: LCG (`srnd()`) seeded from `params.seed`. All generation must use `srnd()`, not `Math.random()`, for reproducibility.

**Point rendering**: Custom WebGL shader (not Three.js default square points). Fragment shader discards pixels outside unit circle (`dot(uv,uv) > 1.0`) and soft anti-aliases the edge. Points are always circular.

**Adjacency / hover**: `setHovered(index)` runs 3-hop BFS cascade using `this._adjacency` (built in `_buildConnections()`). Colors: white → full accent → 60% → 30% dim across hops.

**Edge pulse**: `_buildConnections()` uses a custom `ShaderMaterial` (LINE_VERT/LINE_FRAG) with `aEdgeT`/`aEdgeId` attributes. A Gaussian pulse travels each edge, staggered by golden ratio per edge. `_lineUniforms.uTime` is updated every frame in `update()`.

**Cameras**: Two cameras exist simultaneously — `camera` (PerspectiveCamera, FOV 60) and `orthoCamera` (OrthographicCamera). `activeCamera` points to whichever is active. `toggleOrtho()` syncs position/quaternion and updates OrbitControls. `resize()` updates both frustums; composer uses `renderPass.camera = activeCamera` each frame.

**Post-processing (bloom)**: `EffectComposer` with `RenderPass → UnrealBloomPass → OutputPass`. When `bloomEnabled` is false, `renderer.render()` is called directly (avoids composer overhead). `composer.setSize()` is called on resize. Bloom params: `bloomPass.strength`, `.radius`, `.threshold`.

**Gravity cursor**: Left-mouse-hold sets `cloud.gravityTarget` (a `THREE.Vector3` in cloud local space). Mouse ray is intersected with a `THREE.Plane` at the scene origin facing the camera. Each frame in `_applyGravity()` (called from `update()`), points within `cloudRadius` spring toward the target (lerp 10%/frame); all spring back on release (decay ×0.92/frame). Displacement stored in `this.gravityPerturb` (Float32Array, reset on rebuild).

**Explode on click**: Clicking a point calls `cloud.explode(localPoint)` which sets initial outward velocities in `this.explodeVels`. Each frame, `explodeDisp` integrates velocity with stiffness-0.055 spring restoring force and damping-0.87. Both arrays are nulled when all displacements settle below threshold. `[X]` key explodes from center `(0,0,0)`.

**Audio-reactive mode**: Web Audio API. `getUserMedia` → `AudioContext` → `AnalyserNode` (fftSize 64). Bass bins (0–25%) modulate `params.driftAmp`; treble bins (60–100%) modulate `params.driftSpeed`. Original values are snapshotted on enable and restored on disable. `tickAudio()` is called each frame before `cloud.update()`.

**Named presets**: Up to 12 entries in `localStorage` (key: `pcs_presets`). Each snapshot stores all `SHAREABLE` params. Loading calls `rebuildCloud()` then `syncUIFromParams()` to re-sync all sidebar controls. `renderPresets()` rebuilds the DOM list after every save/delete.

**Exports**:
- **PLY** (ASCII): positions from live position buffer → standard PLY point cloud. Importable in Blender, CloudCompare, MeshLab.
- **STL** (binary): each point → axis-aligned cube (12 triangles, 50 bytes/tri). Half-size `r = max(0.15, cloudRadius / n^(1/3) × 0.3)`. Correct outward normals via right-hand winding. Importable in Blender, slicers (Cura/PrusaSlicer), Fusion 360.
- **Embed**: generates `<iframe src="…">` with all SHAREABLE params encoded in the URL.

**Scanline/CRT overlay**: `#crt-overlay` — fixed, full-screen, `pointer-events:none` div. CSS `repeating-linear-gradient` for 4px scan bands; `::after` radial gradient for vignette. Toggled via `.crt-active` class. Zero GPU cost.

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `1`–`0` | Switch cloud style |
| `R` | Regenerate (new seed) |
| `C` | Screenshot |
| `U` | Copy share URL |
| `P` | Toggle auto-spin |
| `N` | Toggle network/connections |
| `D` | Toggle drift |
| `O` | Toggle orthographic camera |
| `K` | Toggle scanline/CRT overlay |
| `X` | Explode from center |
| `/` or `?` | Keyboard shortcuts help |

## Gotchas

- **WebGL lineWidth**: `lineWidth` param in UI is cosmetic — WebGL 1/2 ignores line width > 1px on most GPUs. The slider exists but has no real visual effect.
- **`lineOpacity` live update**: writes to `this._lineUniforms.uOpacity.value` (not `material.opacity`) because connections use a ShaderMaterial.
- **`preserveDrawingBuffer: true`** on renderer — required for screenshot functionality, slight perf cost.
- **Size attenuation**: Point size uniform = `uSize * uScale / -mvPosition.z`. `uScale` is `renderer.domElement.height / 2` and must be updated on resize via `cloud.setRendererScale()`.
- **Vite base path**: `base: '/Point-cloud-studio/'` in `vite.config.js` — needed for GitHub Pages. Do not remove.
- **Debounce on sliders**: 120ms debounce on rebuild-triggering sliders to avoid thrashing during drag.
- **`depthWrite: false`** on both points and lines — required for correct transparency blending.
- **Bloom + screenshot**: screenshot calls `renderer.render()` directly (not composer) so `preserveDrawingBuffer` captures the frame correctly. If bloom is on, the screenshot won't include bloom.
- **`renderPass.camera`** is updated every frame in the animation loop (`renderPass.camera = activeCamera`) to stay in sync with ortho/perspective toggle — do not set it once at init.
- **Gravity cursor conflicts with OrbitControls**: both listen to `mousedown`. Gravity intentionally activates on any left-click; drag-to-orbit still works because OrbitControls runs first via `controls.update()`. The explode handler fires on `click` (mouseup without significant movement), so dragging does not accidentally trigger explosions.
- **`gravityPerturb` and `explodeDisp/Vels`** are nulled in `_disposeAll()` and re-allocated in `_build()`, so rebuild always starts clean.
- **Audio `driftAmp`/`driftSpeed` writes**: audio-reactive mode writes directly to `params.driftAmp` and `params.driftSpeed` each frame — these are the live values read by `cloud.update()`. It does NOT call `applyParam()` (which would be a no-op for these anyway since they're read directly from `params` in the update loop).
