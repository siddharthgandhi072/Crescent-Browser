import { html, render, useState, useEffect, useRef, useCrescent, useEvent, invoke, displayUrl, hostOf, Favicon, cls } from '../shared/ui.js'
import { Icon } from '../shared/icons.js'
import { themeVars, applyVars } from '../shared/theme.js'

const PRIVATE = new URLSearchParams(location.search).get('private') === '1'

function App() {
  const data = useCrescent()
  const [info, setInfo] = useState({})
  const [editing, setEditing] = useState(false)
  const [toast, setToast] = useState(null)
  const input = useRef(null)
  useEvent('runtime', rt => { if (rt.tabs && rt.tabs.little) setInfo(i => ({ ...i, ...rt.tabs.little })) })
  useEvent('focus-url', () => setEditing(true))
  useEvent('toast', t => { setToast(t.text); setTimeout(() => setToast(null), 1500) })
  useEffect(() => { if (data && data.runtime.tabs && data.runtime.tabs.little) setInfo(data.runtime.tabs.little) }, [!!data])
  useEffect(() => { if (editing && input.current) { input.current.focus(); input.current.select() } }, [editing])
  useEffect(() => {
    if (!data) return
    const st = data.state
    const space = st.spaces.find(s => s.id === st.activeSpaceId) || st.spaces[0]
    const t = themeVars(PRIVATE ? { colors: ['#3b2f55', '#2a2236'], mode: 'dark', grain: 0.5 } : space.theme, st.dark)
    applyVars(document.documentElement, t.vars)
    document.documentElement.classList.toggle('dark', t.dark)
    document.documentElement.classList.toggle('mac', window.crescent.platform === 'darwin')
  }, [data && data.state])
  useEffect(() => { document.title = info.title || 'Little Crescent' }, [info.title])

  const url = info.url || ''
  return html`
    <div class=${cls('frame', PRIVATE && 'private')}>
      <div class="grain" style="opacity:var(--grain)"></div>
      <div class="bar">
        <button class="ib" title="Back" disabled=${!info.canGoBack} onClick=${() => invoke('little:back')}><${Icon} name="back" /></button>
        ${editing ? html`
          <input class="addr" ref=${input} defaultValue=${url} spellcheck=${false}
            onKeyDown=${e => { if (e.key === 'Enter') { invoke('little:navigate', e.target.value); setEditing(false) } if (e.key === 'Escape') setEditing(false) }}
            onBlur=${() => setEditing(false)} placeholder="Search or enter address" />`
        : html`
          <div class="addr" onClick=${() => setEditing(true)} title=${url}>
            ${url ? html`<${Favicon} url=${url} src=${info.favicon} size=${14} />` : html`<${Icon} name="search" size=${13} />`}
            <span class="u">${url ? html`<b>${hostOf(url)}</b>${displayUrl(url).slice(hostOf(url).length)}` : 'Search or enter address'}</span>
            ${info.loading && html`<span class="spin"></span>`}
          </div>`}
        <button class="ib" title="Copy URL" onClick=${() => invoke('little:copyUrl')}><${Icon} name="link" /></button>
        ${PRIVATE
          ? html`<span class="priv"><${Icon} name="incognito" size=${14} /> Private</span>`
          : html`<button class="open" title="Move this page into your main window" onClick=${() => invoke('little:openInMain')}><${Icon} name="open" size=${14} /> Open in Crescent</button>`}
      </div>
      ${toast && html`<div class="toast">${toast}</div>`}
    </div>`
}

render(html`<${App} />`, document.getElementById('root'))
