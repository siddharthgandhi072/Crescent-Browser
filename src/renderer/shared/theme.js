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

export function themeVars(theme, systemDark, { glass = true } = {}) {
  const colors = (theme && theme.colors && theme.colors.length ? theme.colors : ['#d9c6ef', '#f3cfb4']).slice(0, 3)
  const dark = isDark(theme, systemDark)
  const hs = colors.map(c => rgbToHsl(hexToRgb(c)))
  const [h0, s0] = hs[0]
  const alpha = glass ? (dark ? 0.86 : 0.8) : 1
  let stops
  if (dark) {
    stops = hs.map(([h, s, l]) => hsl(h, Math.min(0.42, s * 0.62), Math.min(0.24, 0.11 + l * 0.1)))
  } else {
    stops = hs.map(([h, s, l]) => hsl(h, Math.min(0.7, s * 0.95 + 0.05), Math.max(0.8, Math.min(0.9, 0.62 + l * 0.3))))
  }
  if (stops.length === 1) stops.push(dark ? hsl(h0 + 18, Math.min(0.4, s0 * 0.6), 0.15) : hsl(h0 + 18, Math.min(0.6, s0 * 0.9), 0.89))
  const mid = stops.length === 3 ? `${rgba(stops[1], alpha)} 50%,` : ''
  const last = stops[stops.length - 1]
  const bg = `linear-gradient(160deg, ${rgba(stops[0], alpha)} 0%, ${mid} ${rgba(last, alpha)} 100%)`
  const ink = dark ? hsl(h0, 0.25, 0.93) : hsl(h0, Math.min(0.32, s0 * 0.5), 0.2)
  return {
    dark,
    vars: {
      '--frame': bg,
      '--ink': ink,
      '--muted': rgba(ink, dark ? 0.55 : 0.58),
      '--faint': rgba(ink, 0.36),
      '--hl': dark ? 'rgba(255,255,255,.13)' : 'rgba(255,255,255,.66)',
      '--hov': dark ? 'rgba(255,255,255,.065)' : 'rgba(255,255,255,.32)',
      '--line': rgba(ink, dark ? 0.12 : 0.12),
      '--accent': dark ? hsl(h0, Math.max(0.45, s0), 0.72) : hsl(h0, Math.max(0.4, Math.min(0.6, s0)), 0.48),
      '--grain': String(0.06 + (theme && typeof theme.grain === 'number' ? theme.grain : 0.4) * 0.34),
      '--swatch': `linear-gradient(135deg, ${colors[0]}, ${colors[colors.length - 1]})`,
    },
  }
}

export function applyVars(el, vars) {
  for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v)
}
