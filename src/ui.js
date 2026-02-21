/**
 * UI module — wires up all sidebar controls.
 * Calls onRebuild() for heavy param changes, onParamChange(key, val) for lightweight ones.
 */
export function initUI(params, { onRebuild, onParamChange, onScreenshot }) {

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

  const imageControls = document.getElementById('image-controls')

  const allStyleBtns = [
    ['mode-organic',    'organic'],
    ['mode-structural', 'structural'],
    ['mode-image',      'image'],
    ['mode-crystal',    'crystal'],
    ['mode-terrain',    'terrain'],
    ['mode-fractal',    'fractal'],
    ['mode-galaxy',     'galaxy'],
  ].map(([id, style]) => [document.getElementById(id), style])

  function setCloudStyle(style) {
    params.cloudStyle = style
    for (const [btn, s] of allStyleBtns) {
      btn?.classList.toggle('mode-active', s === style)
    }
    if (imageControls) imageControls.style.display = style === 'image' ? 'block' : 'none'
    onRebuild()
  }

  for (const [btn, style] of allStyleBtns) {
    btn?.addEventListener('click', () => setCloudStyle(style))
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

  const themeCityscan = document.getElementById('theme-cityscan')
  const themeCosmic   = document.getElementById('theme-cosmic')
  const themeBio      = document.getElementById('theme-bio')

  function setTheme(theme) {
    params.colorTheme = theme
    themeCityscan?.classList.toggle('mode-active', theme === 'cityscan')
    themeCosmic?.classList.toggle('mode-active',   theme === 'cosmic')
    themeBio?.classList.toggle('mode-active',      theme === 'bio')
    onParamChange('colorTheme', theme)
    onRebuild()
  }

  themeCityscan?.addEventListener('click', () => setTheme('cityscan'))
  themeCosmic?.addEventListener('click',   () => setTheme('cosmic'))
  themeBio?.addEventListener('click',      () => setTheme('bio'))

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
}
