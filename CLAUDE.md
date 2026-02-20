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
  main.js          # Scene setup, params object, animation loop, raycasting, UI wiring
  pointCloud.js    # All Three.js geometry, shaders, generation algorithms, per-frame update
  ui.js            # Pure DOM binder — reads HTML IDs, calls back via onRebuild/onParamChange
  noise.js         # Seeded Perlin noise + FBM (Fractal Brownian Motion)
  style.css        # Cyberpunk terminal theme
vite.config.js     # base: '/Point-cloud-studio/' for GitHub Pages
```

## Key Patterns

**Params object** (`main.js`): Single source of truth for all state. Passed by reference to `PointCloud` and `initUI`.

**Rebuild vs. live params** — critical distinction:
- **Rebuild** (destroys + recreates geometry): `cloudStyle`, `pointCount`, `cloudRadius`, `noiseScale`, `noiseStrength`, `seed`
- **Live** (no rebuild, uniform/material update only): `pointSize`, `lineOpacity`, `lineWidth`, `driftSpeed`, `driftAmp`, `driftEnabled`
- **Reconnect** (rebuild edges only): `connectionsEnabled`, `connectionDist`

**Cloud styles** (`params.cloudStyle`):
- `'organic'` — spherical random distribution + Perlin FBM displacement
- `'structural'` — procedural cityscape with CDF-weighted building placement + LiDAR scan ring banding
- `'image'` — image upload drives height map or density map; falls back to Lissajous pattern if no image loaded

**Color themes** (`params.colorTheme`): `'cityscan'` (teal), `'cosmic'` (purple), `'bio'` (green). Theme changes update renderer clear color, fog, line shader uniform, and trigger rebuild to bake new point colors.

**Image mode** (`params.imageData/imageWidth/imageHeight/imageMapMode`): Raw `Uint8ClampedArray` from offscreen canvas (max 256×256). Height map = Y from brightness; density map = rejection sampling clusters points in bright areas.

**Seeded RNG**: LCG (`srnd()`) seeded from `params.seed`. All generation must use `srnd()`, not `Math.random()`, for reproducibility.

**Point rendering**: Custom WebGL shader (not Three.js default square points). Fragment shader discards pixels outside unit circle (`dot(uv,uv) > 1.0`) and soft anti-aliases the edge. Points are always circular.

**Adjacency / hover**: `setHovered(index)` runs 3-hop BFS cascade using `this._adjacency` (built in `_buildConnections()`). Colors: white → full accent → 60% → 30% dim across hops.

**Edge pulse**: `_buildConnections()` uses a custom `ShaderMaterial` (LINE_VERT/LINE_FRAG) with `aEdgeT`/`aEdgeId` attributes. A Gaussian pulse travels each edge, staggered by golden ratio per edge. `_lineUniforms.uTime` is updated every frame in `update()`.

## Gotchas

- **WebGL lineWidth**: `lineWidth` param in UI is cosmetic — WebGL 1/2 ignores line width > 1px on most GPUs. The slider exists but has no real visual effect.
- **`lineOpacity` live update**: now writes to `this._lineUniforms.uOpacity.value` (not `material.opacity`) because connections use a ShaderMaterial.
- **`preserveDrawingBuffer: true`** on renderer — required for screenshot functionality, slight perf cost.
- **Size attenuation**: Point size uniform = `uSize * uScale / -mvPosition.z`. `uScale` is `renderer.domElement.height / 2` and must be updated on resize via `cloud.setRendererScale()`.
- **Vite base path**: `base: '/Point-cloud-studio/'` in `vite.config.js` — needed for GitHub Pages. Do not remove.
- **Debounce on sliders**: 120ms debounce on rebuild-triggering sliders to avoid thrashing during drag.
- **`depthWrite: false`** on both points and lines — required for correct transparency blending.
