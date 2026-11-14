// Command-bar calculator and unit converter. A tiny recursive-descent
// parser (no eval), so typed text can never run code.

const UNITS = {
  // length (m)
  mm: ['len', 0.001], cm: ['len', 0.01], m: ['len', 1], km: ['len', 1000], in: ['len', 0.0254], inch: ['len', 0.0254], inches: ['len', 0.0254],
  ft: ['len', 0.3048], foot: ['len', 0.3048], feet: ['len', 0.3048], yd: ['len', 0.9144], mi: ['len', 1609.344], mile: ['len', 1609.344], miles: ['len', 1609.344],
  // mass (kg)
  mg: ['mass', 1e-6], g: ['mass', 0.001], kg: ['mass', 1], lb: ['mass', 0.45359237], lbs: ['mass', 0.45359237], oz: ['mass', 0.028349523125], t: ['mass', 1000],
  // time (s)
  ms: ['time', 0.001], s: ['time', 1], sec: ['time', 1], min: ['time', 60], h: ['time', 3600], hr: ['time', 3600], hours: ['time', 3600], day: ['time', 86400], days: ['time', 86400], week: ['time', 604800], weeks: ['time', 604800], year: ['time', 31557600], years: ['time', 31557600],
  // data (bytes)
  b: ['data', 1], kb: ['data', 1e3], mb: ['data', 1e6], gb: ['data', 1e9], tb: ['data', 1e12], kib: ['data', 1024], mib: ['data', 1048576], gib: ['data', 1073741824],
  // speed (m/s)
  mph: ['speed', 0.44704], kph: ['speed', 1 / 3.6], kmh: ['speed', 1 / 3.6], 'km/h': ['speed', 1 / 3.6], 'm/s': ['speed', 1],
  // volume (l)
  ml: ['vol', 0.001], l: ['vol', 1], gal: ['vol', 3.785411784], cup: ['vol', 0.2365882365], cups: ['vol', 0.2365882365], floz: ['vol', 0.0295735295625],
  // temperature handled separately
  c: ['temp'], f: ['temp'], k: ['temp'], '°c': ['temp'], '°f': ['temp'],
}

function convertTemp(v, from, to) {
  from = from.replace('°', ''); to = to.replace('°', '')
  const c = from === 'c' ? v : from === 'f' ? (v - 32) * 5 / 9 : v - 273.15
  return to === 'c' ? c : to === 'f' ? c * 9 / 5 + 32 : c + 273.15
}

export function calculate(input) {
  const text = String(input || '').trim().toLowerCase().replace(/,/g, '').replace(/×/g, '*').replace(/÷/g, '/')
  if (!text || text.length > 120) return null
  // "5 km in miles", "100 f to c"
  const conv = /^(-?[\d.]+(?:e-?\d+)?)\s*([a-z°/]+)\s+(?:in|to|as)\s+([a-z°/]+)$/.exec(text)
  if (conv) {
    const v = parseFloat(conv[1]); const a = UNITS[conv[2]]; const b = UNITS[conv[3]]
    if (!a || !b || a[0] !== b[0] || !isFinite(v)) return null
    const r = a[0] === 'temp' ? convertTemp(v, conv[2], conv[3]) : (v * a[1]) / b[1]
    return { expr: `${conv[1]} ${conv[2]} in ${conv[3]}`, value: fmt(r) + ' ' + conv[3] }
  }
  // Plain arithmetic: needs an operator or function so a bare number isn't a "result".
  if (!/[-+*/^%()]|sqrt|sin|cos|tan|log|ln|pi/.test(text) || !/\d|pi/.test(text)) return null
  if (/[^\d\s.+\-*/^%()a-z]/.test(text)) return null
  try {
    const r = parse(text)
    if (typeof r !== 'number' || !isFinite(r)) return null
    return { expr: text, value: fmt(r) }
  } catch { return null }
}

function fmt(n) {
  if (Math.abs(n) >= 1e15 || (Math.abs(n) < 1e-6 && n !== 0)) return n.toExponential(6)
  return String(Math.round(n * 1e10) / 1e10)
}

function parse(src) {
  let i = 0
  const peek = () => src[i]
  const ws = () => { while (src[i] === ' ') i++ }
  const num = () => {
    ws()
    const m = /^(\d+\.?\d*|\.\d+)(e-?\d+)?/.exec(src.slice(i))
    if (m) { i += m[0].length; return parseFloat(m[0]) }
    const w = /^[a-z]+/.exec(src.slice(i))
    if (w) {
      i += w[0].length
      if (w[0] === 'pi') return Math.PI
      if (w[0] === 'e') return Math.E
      const fns = { sqrt: Math.sqrt, sin: Math.sin, cos: Math.cos, tan: Math.tan, log: Math.log10, ln: Math.log, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil }
      const f = fns[w[0]]
      if (!f) throw new Error('unknown')
      ws()
      if (src[i] !== '(') throw new Error('(')
      i++
      const v = expr()
      ws(); if (src[i] !== ')') throw new Error(')'); i++
      return f(v)
    }
    if (src[i] === '(') { i++; const v = expr(); ws(); if (src[i] !== ')') throw new Error(')'); i++; return v }
    if (src[i] === '-') { i++; return -factor() }
    if (src[i] === '+') { i++; return factor() }
    throw new Error('number')
  }
  const factor = () => {
    let v = num()
    ws()
    if (peek() === '%') { i++; v /= 100 }
    ws()
    if (peek() === '^') { i++; v = Math.pow(v, factor()) }
    return v
  }
  const term = () => {
    let v = factor()
    for (;;) {
      ws()
      const c = peek()
      if (c === '*') { i++; v *= factor() } else if (c === '/') { i++; v /= factor() } else return v
    }
  }
  const expr = () => {
    let v = term()
    for (;;) {
      ws()
      const c = peek()
      if (c === '+') { i++; v += term() } else if (c === '-') { i++; v -= term() } else return v
    }
  }
  const v = expr()
  ws()
  if (i < src.length) throw new Error('trailing')
  return v
}
