'use strict'
// Runs in every website frame (sandboxed). Only job: password autofill and
// offering to save new logins. Pages never get passwords for other sites;
// the main process checks the frame's origin on every call.
const { ipcRenderer } = require('electron')

if (/^https?:$/.test(location.protocol)) {
  const ask = (action, data) => ipcRenderer.invoke('page:invoke', action, data).catch(() => null)
  let menu = null
  let cache = null

  const isPw = el => el && el.tagName === 'INPUT' && el.type === 'password'
  const isUser = el => el && el.tagName === 'INPUT' && /^(text|email|tel)$/.test(el.type || 'text') &&
    /user|email|login|account|name|phone|id/i.test((el.name || '') + (el.id || '') + (el.autocomplete || '') + (el.placeholder || ''))

  function fields(from) {
    const scope = (from && from.form) || document
    const pw = [...scope.querySelectorAll('input[type=password]')].find(visible)
    if (!pw) return null
    const inputs = [...scope.querySelectorAll('input')].filter(visible)
    const idx = inputs.indexOf(pw)
    let user = null
    for (let i = idx - 1; i >= 0; i--) if (isUser(inputs[i]) || /^(text|email)$/.test(inputs[i].type)) { user = inputs[i]; break }
    return { pw, user }
  }

  function visible(el) {
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'
  }

  function setValue(el, v) {
    if (!el) return
    const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
    proto.set.call(el, v) // works with React-controlled inputs
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }

  function close() { if (menu) { menu.remove(); menu = null } }

  async function show(anchor) {
    if (!cache) cache = await ask('query')
    if (!cache || !cache.length) return
    close()
    const host = document.createElement('div')
    const root = host.attachShadow({ mode: 'closed' })
    const r = anchor.getBoundingClientRect()
    host.style.cssText = `position:fixed;z-index:2147483647;left:${Math.round(r.left)}px;top:${Math.round(r.bottom + 4)}px;`
    const dark = matchMedia('(prefers-color-scheme: dark)').matches
    root.innerHTML = `<style>
      .m{font:13px -apple-system,system-ui,sans-serif;min-width:${Math.max(220, Math.round(r.width))}px;background:${dark ? '#2a2630' : '#fff'};color:${dark ? '#eee' : '#222'};
      border-radius:10px;padding:5px;box-shadow:0 10px 30px rgba(0,0,0,.22),0 0 0 .5px rgba(0,0,0,.15)}
      .h{font-size:11px;opacity:.55;padding:5px 9px 3px}
      button{all:unset;display:block;box-sizing:border-box;width:100%;padding:7px 9px;border-radius:7px;cursor:default}
      button:hover,button:focus{background:${dark ? 'rgba(255,255,255,.08)' : '#f0ebf6'}}
      small{display:block;opacity:.55;font-size:11px}</style>
      <div class="m"><div class="h">Crescent passwords</div></div>`
    const m = root.querySelector('.m')
    for (const login of cache.slice(0, 6)) {
      const b = document.createElement('button')
      b.innerHTML = `<span></span><small>••••••••</small>`
      b.firstChild.textContent = login.username || '(no username)'
      b.addEventListener('mousedown', async e => {
        e.preventDefault()
        const cred = await ask('fill', login.id)
        if (!cred) return
        const f = fields(anchor)
        if (f) { setValue(f.user, cred.username); setValue(f.pw, cred.password) }
        close()
      })
      m.appendChild(b)
    }
    document.documentElement.appendChild(host)
    menu = host
  }

  document.addEventListener('focusin', e => {
    const el = e.target
    if (isPw(el) || (isUser(el) && fields(el))) show(el)
  }, true)
  document.addEventListener('focusout', () => setTimeout(close, 150), true)
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close() }, true)
  addEventListener('scroll', close, { passive: true, capture: true })

  // Offer to save after a sign-in form is submitted.
  let lastOffer = ''
  function capture(from) {
    const f = fields(from)
    if (!f || !f.pw.value || f.pw.value.length < 3) return
    // Skip sign-up "confirm password" double fields being half-filled etc.
    const key = (f.user ? f.user.value : '') + '\u0000' + f.pw.value
    if (key === lastOffer) return
    lastOffer = key
    cache = null
    ask('offer', { username: f.user ? f.user.value : '', password: f.pw.value })
  }
  document.addEventListener('submit', e => capture(e.target.querySelector('input[type=password]') || e.target), true)
  document.addEventListener('click', e => {
    const b = e.target && e.target.closest && e.target.closest('button,input[type=submit],[role=button]')
    if (!b) return
    const f = fields(b)
    if (f && f.pw.value) setTimeout(() => capture(b), 0)
  }, true)
  document.addEventListener('keydown', e => { if (e.key === 'Enter' && isPw(e.target)) capture(e.target) }, true)
}
