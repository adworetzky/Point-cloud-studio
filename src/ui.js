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
