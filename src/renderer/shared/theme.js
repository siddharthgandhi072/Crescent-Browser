// Turns a space theme ({ colors, mode, grain }) into CSS variables.
// Light themes are pastel washes of your colours; dark themes are deep,
// desaturated versions. Text colour is derived from the theme hue so it
// always feels part of the palette and keeps contrast.

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
export function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')
}
export function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  let h = 0, s = 0
  const l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
    h *= 60
  }
  return [h, s, l]
}
export function hslToRgb([h, s, l]) {
  h = ((h % 360) + 360) % 360
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255]
}
const hsl = (h, s, l) => rgbToHex(hslToRgb([h, s, l]))
const rgba = (hex, a) => { const [r, g, b] = hexToRgb(hex); return `rgba(${r}, ${g}, ${b}, ${a})` }

export function isDark(theme, systemDark) {
  const mode = (theme && theme.mode) || 'auto'
  return mode === 'dark' || (mode === 'auto' && !!systemDark)
}

function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

// theme: { colors[1-3], mode, grain, angle, style: linear|radial|mesh, intensity 0-1 }
// opts.glass: 0.5-1 sidebar opacity over the desktop blur.
export function themeVars(theme, systemDark, opts = {}) {
  const t = theme || {}
  const colors = (t.colors && t.colors.length ? t.colors : ['#d9c6ef', '#f3cfb4']).slice(0, 3)
  const dark = isDark(t, systemDark)
  const k = typeof t.intensity === 'number' ? Math.max(0, Math.min(1, t.intensity)) : 0.5
  const angle = typeof t.angle === 'number' ? t.angle : 160
  const style = t.style || 'linear'
  const glass = typeof opts.glass === 'number' ? Math.max(0.45, Math.min(1, opts.glass)) : 0.8
  const hs = colors.map(c => rgbToHsl(hexToRgb(c)))
  const [h0, s0] = hs[0]
  const alpha = dark ? Math.min(1, glass + 0.06) : glass
  // Intensity 0 = soft wash, 1 = the colours exactly as picked.
  const stops = hs.map(([h, s, l]) => dark
    ? hsl(h, Math.min(0.85, s * (0.35 + k * 0.6)), 0.08 + k * 0.2 + Math.min(0.06, l * 0.05))
    : hsl(h, Math.min(1, s * (0.45 + k * 0.6) + 0.04), 0.93 - k * (0.93 - Math.max(0.42, Math.min(0.88, l)))))
  if (stops.length === 1) {
    const [h, s] = hs[0]
    stops.push(dark ? hsl(h + 18, Math.min(0.6, s * 0.5), 0.07 + k * 0.12) : hsl(h + 18, Math.min(0.8, s * 0.7), 0.95 - k * 0.2))
  }
  const A = c => rgba(c, alpha)
  let bg
  if (style === 'radial') {
    bg = `radial-gradient(120% 120% at 20% 10%, ${stops.map((c, i) => `${A(c)} ${Math.round((i / (stops.length - 1)) * 100)}%`).join(', ')})`
  } else if (style === 'mesh') {
    const third = stops[2] || stops[0]
    bg = [
      `radial-gradient(70% 60% at 12% 18%, ${A(stops[0])} 0%, transparent 70%)`,
      `radial-gradient(65% 55% at 88% 30%, ${A(stops[1])} 0%, transparent 70%)`,
      `radial-gradient(80% 60% at 40% 100%, ${A(third)} 0%, transparent 72%)`,
      `linear-gradient(${angle}deg, ${A(mix(stops[0], stops[1], 0.5))}, ${A(mix(stops[1], third, 0.5))})`,
    ].join(', ')
  } else {
    bg = `linear-gradient(${angle}deg, ${stops.map((c, i) => `${A(c)} ${Math.round((i / (stops.length - 1)) * 100)}%`).join(', ')})`
  }
  // Text colour follows how light the background actually is.
  const avgLum = stops.reduce((a, c) => a + luminance(c), 0) / stops.length
  const lightText = avgLum < 0.36
  const ink = lightText ? hsl(h0, 0.22, 0.94) : hsl(h0, Math.min(0.35, s0 * 0.5), 0.17)
  return {
    dark: lightText,
    vars: {
      '--frame': bg,
      '--ink': ink,
      '--muted': rgba(ink, lightText ? 0.58 : 0.6),
      '--faint': rgba(ink, 0.36),
      '--hl': lightText ? 'rgba(255,255,255,.14)' : 'rgba(255,255,255,.62)',
      '--hov': lightText ? 'rgba(255,255,255,.07)' : 'rgba(255,255,255,.3)',
      '--line': rgba(ink, 0.12),
      '--accent': lightText ? hsl(h0, Math.max(0.5, s0), 0.74) : hsl(h0, Math.max(0.45, Math.min(0.7, s0)), 0.45),
      '--grain': String(0.04 + (typeof t.grain === 'number' ? t.grain : 0.4) * 0.38),
      '--swatch': `linear-gradient(135deg, ${colors[0]}, ${colors[colors.length - 1]})`,
    },
  }
}

function mix(a, b, w) {
  const x = hexToRgb(a), y = hexToRgb(b)
  return rgbToHex(x.map((v, i) => v * (1 - w) + y[i] * w))
}

// Settings that change the whole UI (font, density, corners).
export function appearanceVars(settings = {}) {
  const font = {
    crescent: "'Crescent Sans', -apple-system, system-ui, sans-serif",
    system: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif",
    rounded: "ui-rounded, 'SF Pro Rounded', -apple-system, system-ui, sans-serif",
    mono: "ui-monospace, 'SF Mono', Menlo, monospace",
  }[settings.uiFont] || "'Crescent Sans', -apple-system, system-ui, sans-serif"
  const row = { compact: 29, comfortable: 34, roomy: 38 }[settings.density] || 34
  return {
    '--font': font,
    '--row': row + 'px',
    '--row-font': settings.density === 'compact' ? '13px' : '13.5px',
    '--grid-cols': String(Math.max(3, Math.min(6, Number(settings.gridColumns) || 4))),
    '--page-radius': (Number(settings.pageRadius) || 0) + 'px',
  }
}

export function applyVars(el, vars) {
  for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v)
}
