/**
 * UI module — wires up all sidebar controls.
 * Calls onRebuild() for heavy param changes, onParamChange(key, val) for lightweight ones.
 */
export function initUI(params, { onRebuild, onParamChange, onScreenshot, onShare }) {

  // ─── Slider helper ──────────────────────────────────────────────────────

  function bindSlider(id, key, decimals = 0, isRebuild = false) {
    const input = document.getElementById(id)
    const display = document.getElementById(id + '-val')
    if (!input) return

    input.value = params[key]
    if (display) display.textContent = Number(params[key]).toFixed(decimals)

    let debounceTimer = null

    input.addEventListener('input', () => {
      const val = parseFloat(input.value)
      if (display) display.textContent = val.toFixed(decimals)
      params[key] = val

      if (isRebuild) {
        clearTimeout(debounceTimer)
        debounceTimer = setTimeout(onRebuild, 120)
      } else {
        onParamChange(key, val)
      }
    })
  }

  // ─── Toggle helper ──────────────────────────────────────────────────────

  function bindToggle(id, key, textId, onText = 'ON', offText = 'OFF', isRebuild = false, controlsId = null) {
    const input = document.getElementById(id)
    const text  = document.getElementById(textId)
    const controls = controlsId ? document.getElementById(controlsId) : null
    if (!input) return

    input.checked = params[key]
    if (text) text.textContent = params[key] ? onText : offText
    if (controls) controls.style.opacity = params[key] ? '1' : '0.35'

    input.addEventListener('change', () => {
      params[key] = input.checked
      if (text) text.textContent = input.checked ? onText : offText
      if (controls) controls.style.opacity = input.checked ? '1' : '0.35'

      if (isRebuild) {
        onRebuild()
      } else {
        onParamChange(key, input.checked)
      }
    })
  }

  // ─── Cloud style selector ───────────────────────────────────────────────

  const imageControls  = document.getElementById('image-controls')
  const styleOptsPanel = document.getElementById('style-opts-panel')
  const styleOptsPanels = {
    galaxy:  document.getElementById('style-opts-galaxy'),
    terrain: document.getElementById('style-opts-terrain'),
  }

  const allStyleBtns = [
    ['mode-organic',           'organic'],
    ['mode-structural',        'structural'],
    ['mode-image',             'image'],
    ['mode-crystal',           'crystal'],
    ['mode-terrain',           'terrain'],
    ['mode-fractal',           'fractal'],
    ['mode-galaxy',            'galaxy'],
    ['mode-reactiondiffusion', 'reactiondiffusion'],
    ['mode-fluid',             'fluid'],
    ['mode-lsystem',           'lsystem'],
  ].map(([id, style]) => [document.getElementById(id), style])

  function setCloudStyle(style) {
    params.cloudStyle = style
    for (const [btn, s] of allStyleBtns) {
      btn?.classList.toggle('mode-active', s === style)
    }
    if (imageControls) imageControls.style.display = style === 'image' ? 'block' : 'none'
    // Show/hide style-specific options
    const hasOpts = style in styleOptsPanels
    if (styleOptsPanel) styleOptsPanel.style.display = hasOpts ? '' : 'none'
    for (const [s, panel] of Object.entries(styleOptsPanels)) {
      if (panel) panel.style.display = s === style ? '' : 'none'
    }
    onRebuild()
  }

  for (const [btn, style] of allStyleBtns) {
    btn?.addEventListener('click', () => setCloudStyle(style))
  }

  // Sync button active states + panels for URL-loaded params (no rebuild)
  {
    const s = params.cloudStyle
    for (const [btn, st] of allStyleBtns) btn?.classList.toggle('mode-active', st === s)
    if (imageControls) imageControls.style.display = s === 'image' ? 'block' : 'none'
    const hasOpts = s in styleOptsPanels
    if (styleOptsPanel) styleOptsPanel.style.display = hasOpts ? '' : 'none'
    for (const [st, panel] of Object.entries(styleOptsPanels)) {
      if (panel) panel.style.display = st === s ? '' : 'none'
    }
  }

  // ─── Image upload ────────────────────────────────────────────────────────

  const imageUpload    = document.getElementById('imageUpload')
  const btnImageUpload = document.getElementById('btn-image-upload')
  const imageFilename  = document.getElementById('image-filename')

  btnImageUpload?.addEventListener('click', () => imageUpload?.click())

  imageUpload?.addEventListener('change', () => {
    const file = imageUpload.files[0]
    if (!file) return
    if (imageFilename) imageFilename.textContent = file.name.slice(0, 14)

    const img = new Image()
    const url = URL.createObjectURL(file)

    img.onload = () => {
      // Downsample to max 256×256 for performance
      const maxDim = 256
      const scale  = Math.min(1, maxDim / Math.max(img.width, img.height))
      const w      = Math.round(img.width  * scale)
      const h      = Math.round(img.height * scale)

      const offscreen = document.createElement('canvas')
      offscreen.width  = w
      offscreen.height = h
      const ctx = offscreen.getContext('2d')
      ctx.drawImage(img, 0, 0, w, h)

      const raw = ctx.getImageData(0, 0, w, h)
      params.imageData   = raw.data
      params.imageWidth  = w
      params.imageHeight = h
      URL.revokeObjectURL(url)

      if (params.cloudStyle === 'image') onRebuild()
    }

    img.src = url
  })

  // ─── Map mode toggle ─────────────────────────────────────────────────────

  const mapmodeHeight  = document.getElementById('mapmode-height')
  const mapmodeDensity = document.getElementById('mapmode-density')

  function setMapMode(mode) {
    params.imageMapMode = mode
    mapmodeHeight?.classList.toggle('mode-active',  mode === 'height')
    mapmodeDensity?.classList.toggle('mode-active', mode === 'density')
    if (params.cloudStyle === 'image') onRebuild()
  }

  mapmodeHeight?.addEventListener('click',  () => setMapMode('height'))
  mapmodeDensity?.addEventListener('click', () => setMapMode('density'))

  // ─── Color theme selector ────────────────────────────────────────────────

  const allThemeBtns = [
    ['theme-cityscan', 'cityscan'],
    ['theme-cosmic',   'cosmic'],
    ['theme-bio',      'bio'],
    ['theme-infrared', 'infrared'],
    ['theme-mono',     'mono'],
    ['theme-sunset',   'sunset'],
  ].map(([id, theme]) => [document.getElementById(id), theme])

  function setTheme(theme) {
    params.colorTheme = theme
    for (const [btn, t] of allThemeBtns) btn?.classList.toggle('mode-active', t === theme)
    onParamChange('colorTheme', theme)
    onRebuild()
  }

  for (const [btn, theme] of allThemeBtns) btn?.addEventListener('click', () => setTheme(theme))

  // Sync active state for URL-loaded theme
  for (const [btn, t] of allThemeBtns) btn?.classList.toggle('mode-active', t === params.colorTheme)

  // ─── Geometry (rebuild on change) ───────────────────────────────────────

  bindSlider('pointCount',    'pointCount',    0, true)
  bindSlider('cloudRadius',   'cloudRadius',   0, true)
  bindSlider('noiseScale',    'noiseScale',    2, true)
  bindSlider('noiseStrength', 'noiseStrength', 2, true)

  // ─── Point size (live, no rebuild) ──────────────────────────────────────

  bindSlider('pointSize', 'pointSize', 1, false)

  // ─── Connections ────────────────────────────────────────────────────────

  bindToggle('connectionsEnabled', 'connectionsEnabled', 'connections-toggle-text', 'ON', 'OFF', false, 'connections-controls')
  bindSlider('connectionDist', 'connectionDist', 1, false)
  bindSlider('lineOpacity',    'lineOpacity',    2, false)
  bindSlider('lineWidth',      'lineWidth',      2, false)

  // ─── Drift ──────────────────────────────────────────────────────────────

  bindToggle('driftEnabled', 'driftEnabled', 'drift-toggle-text', 'ON', 'OFF', false, 'drift-controls')
  bindSlider('driftSpeed', 'driftSpeed', 3, false)
  bindSlider('driftAmp',   'driftAmp',   1, false)

  // ─── Seed input ─────────────────────────────────────────────────────────

  const seedInput = document.getElementById('seedInput')
  if (seedInput) {
    seedInput.value = params.seed
    seedInput.addEventListener('change', () => {
      const v = parseInt(seedInput.value, 10)
      if (!isNaN(v) && v >= 0) {
        params.seed = v
        onRebuild()
      }
    })
  }

  // ─── Buttons ────────────────────────────────────────────────────────────

  document.getElementById('btn-regenerate')?.addEventListener('click', () => {
    params.seed = Math.floor(Math.random() * 99999)
    if (seedInput) seedInput.value = params.seed
    onRebuild()
  })

  document.getElementById('btn-random-seed')?.addEventListener('click', () => {
    params.seed = Math.floor(Math.random() * 99999)
    if (seedInput) seedInput.value = params.seed
    onRebuild()
  })

  document.getElementById('btn-screenshot')?.addEventListener('click', onScreenshot)
  document.getElementById('btn-share')?.addEventListener('click', onShare)

  // ─── Auto-spin ───────────────────────────────────────────────────────────

  bindToggle('autoSpin', 'autoSpin', 'autoSpin-text', 'ON', 'OFF', false, 'spin-controls')
  bindSlider('spinSpeed', 'spinSpeed', 2, false)

  // ─── Style-specific options ──────────────────────────────────────────────

  bindSlider('galaxyArms',    'galaxyArms',    0, true)
  bindSlider('terrainStrata', 'terrainStrata', 0, true)

  // ─── Positional hue shift ────────────────────────────────────────────────

  const hueControls = document.getElementById('hue-controls')

  const colorModeBtns = [
    ['colormode-theme',      'theme'],
    ['colormode-positional', 'positional'],
  ].map(([id, mode]) => [document.getElementById(id), mode])

  function setColorMode(mode) {
    params.colorMode = mode
    for (const [btn, m] of colorModeBtns) btn?.classList.toggle('mode-active', m === mode)
    if (hueControls) hueControls.style.display = mode === 'positional' ? '' : 'none'
    onRebuild()
  }

  for (const [btn, mode] of colorModeBtns) btn?.addEventListener('click', () => setColorMode(mode))

  // Sync on load
  for (const [btn, m] of colorModeBtns) btn?.classList.toggle('mode-active', m === params.colorMode)
  if (hueControls) hueControls.style.display = params.colorMode === 'positional' ? '' : 'none'

  const hueAxisBtns = [
    ['hueaxis-y',      'y'],
    ['hueaxis-radial', 'radial'],
    ['hueaxis-x',      'x'],
    ['hueaxis-z',      'z'],
  ].map(([id, axis]) => [document.getElementById(id), axis])

  function setHueAxis(axis) {
    params.hueAxis = axis
    for (const [btn, a] of hueAxisBtns) btn?.classList.toggle('mode-active', a === axis)
    onRebuild()
  }

  for (const [btn, axis] of hueAxisBtns) btn?.addEventListener('click', () => setHueAxis(axis))
  for (const [btn, a] of hueAxisBtns) btn?.classList.toggle('mode-active', a === params.hueAxis)

  // hueRange and hueOffset with degree suffix
  ;['hueRange', 'hueOffset'].forEach(id => {
    const input = document.getElementById(id)
    const display = document.getElementById(id + '-val')
    if (!input) return
    input.value = params[id]
    if (display) display.textContent = params[id] + '°'
    let timer = null
    input.addEventListener('input', () => {
      const val = parseInt(input.value, 10)
      params[id] = val
      if (display) display.textContent = val + '°'
      clearTimeout(timer)
      timer = setTimeout(onRebuild, 120)
    })
  })
}
