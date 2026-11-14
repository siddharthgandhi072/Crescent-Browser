import { html, render, useState, useEffect, useRef, useCrescent, useEvent, invoke, cls } from '../shared/ui.js'
import { Icon, ICON_NAMES } from '../shared/icons.js'

const PALETTE = [
  ['#d9c6ef', '#f3cfb4'], ['#bfe0d0', '#e8efc0'], ['#b9cdf3', '#d8c4f0'], ['#f3c0c0', '#f6e0b0'], ['#c4e3f0', '#c7c4f3'], ['#efd3a8', '#e6b8a9'],
]
const SUGGEST = [
  { name: 'School', icon: 'school' }, { name: 'Personal', icon: 'home' }, { name: 'Work', icon: 'briefcase' },
  { name: 'Cars', icon: 'car' }, { name: 'Music', icon: 'music' }, { name: 'Gaming', icon: 'game' }, { name: 'Projects', icon: 'code' },
]
const BROWSER_COLORS = { arc: '#4b56d8', chrome: '#3b78e7', brave: '#e1572a', helium: '#5c5c66', edge: '#2a8bd6', vivaldi: '#d6383d', opera: '#d12b39', dia: '#6b5ad6', chromium: '#4a7fd8', zen: '#3b7d4a', firefox: '#e66a1f', librewolf: '#3f6fd0', floorp: '#3a8ad6', safari: '#2a6fd6' }
const WHAT = [
  ['spaces', 'Spaces & pinned tabs', 'pin'], ['bookmarks', 'Bookmarks', 'book'], ['history', 'History', 'clock'],
  ['passwords', 'Passwords', 'key'], ['cookies', 'Stay signed in', 'lock'], ['extensions', 'Extensions', 'puzzle'],
]
const STEPS = 5

function App() {
  const data = useCrescent()
  const [step, setStep] = useState(0)
  const [spaces, setSpaces] = useState([{ name: 'Personal', icon: 'home', colors: PALETTE[0] }, { name: 'School', icon: 'school', colors: PALETTE[2] }])
  const [pinsMode, setPinsMode] = useState('global')
  const [engine, setEngine] = useState('google')
  const [isDefault, setIsDefault] = useState(false)
  const [imported, setImported] = useState(null)

  useEffect(() => { document.documentElement.classList.toggle('mac', window.crescent.platform === 'darwin') }, [])
  useEffect(() => { if (data) document.documentElement.classList.toggle('dark', !!data.state.dark) }, [data && data.state.dark])
  useEffect(() => {
    // An import that brought spaces replaces the suggested starter spaces.
    if (imported && imported.spaces > 0) setSpaces([])
  }, [imported])

  const next = () => setStep(s => Math.min(STEPS - 1, s + 1))
  const back = () => setStep(s => Math.max(0, s - 1))
  const finish = () => invoke('setup:finish', {
    spaces: spaces.filter(s => s.name.trim()).map(s => ({ name: s.name.trim(), icon: s.icon, theme: { colors: s.colors, mode: 'auto', grain: 0.4 } })),
    pinsMode, searchEngine: engine,
  })
  const existing = data ? data.state.spaces.filter(s => s.imported) : []

  return html`
    <div class="bg"><div class="rib"></div><div class="grain" style="opacity:.25"></div></div>
    <div class="drag"></div>
    <div class="steps">${Array.from({ length: STEPS }, (_, i) => html`<i class=${cls(i <= step && 'on')}></i>`)}</div>
    <div class="card" key=${step}>
      ${step === 0 && html`<${Welcome} next=${next} />`}
      ${step === 1 && html`<${Import} next=${next} back=${back} onDone=${setImported} />`}
      ${step === 2 && html`<${Spaces} spaces=${spaces} setSpaces=${setSpaces} existing=${existing} next=${next} back=${back} />`}
      ${step === 3 && html`<${Pins} pinsMode=${pinsMode} setPinsMode=${setPinsMode} engine=${engine} setEngine=${setEngine} next=${next} back=${back} />`}
      ${step === 4 && html`<${Default} isDefault=${isDefault} setIsDefault=${setIsDefault} finish=${finish} back=${back} />`}
    </div>`
}

function Welcome({ next }) {
  return html`
    <img class="logo" src="../shared/icon.png" />
    <h1>A calmer way<br />to <em>browse</em>.</h1>
    <p class="lede">Crescent keeps your tabs in a sidebar, your work in spaces, and your favourite sites one click away. Setting it up takes about a minute.</p>
    <ul class="points">
      <li><${Icon} name="sidebar" /> Vertical tabs that tidy themselves</li>
      <li><${Icon} name="moon" /> Spaces with their own colours</li>
      <li><${Icon} name="puzzle" /> Chrome extensions, Chromium engine</li>
    </ul>
    <div class="btns end"><button class="pri" onClick=${next} autofocus>Get started <${Icon} name="arrow" /></button></div>`
}

function Import({ next, back, onDone }) {
  const [sources, setSources] = useState(null)
  const [sel, setSel] = useState(null)
  const [open, setOpen] = useState(false)
  const [what, setWhat] = useState({ spaces: true, bookmarks: true, history: true, passwords: true, cookies: true, extensions: true })
  const [busy, setBusy] = useState(null)
  const [result, setResult] = useState(null)
  useEffect(() => { invoke('import:detect').then(l => { setSources(l || []); if (l && l.length) setSel(l[0]) }) }, [])
  useEvent('import:progress', p => setBusy(p.step))

  const run = async () => {
    setBusy('Starting…')
    const enabled = Object.fromEntries(Object.entries(what).filter(([k]) => sel.can[k]))
    const r = await invoke('import:run', sel.id, enabled)
    setBusy(null)
    setResult(r)
    onDone(r)
  }

  if (result) {
    const lines = [
      result.spaces && `${result.spaces} spaces with their pinned tabs`,
      result.bookmarks && `${result.bookmarks} bookmarks`, result.history && `${result.history.toLocaleString()} history entries`,
      result.passwords && `${result.passwords} passwords`, result.cookies && `Signed in to your sites (${result.cookies.toLocaleString()} cookies)`,
      result.extensions && `${result.extensions} extensions`,
    ].filter(Boolean)
    return html`
      <div class="tag">Imported from ${result.source}</div>
      <h1>All <em>moved in</em>.</h1>
      ${result.error ? html`<p class="lede err">${result.error}</p>` : html`
        <ul class="done">${lines.length ? lines.map(l => html`<li><${Icon} name="check" /> ${l}</li>`) : html`<li>Nothing new to bring over.</li>`}</ul>`}
      ${result.warnings && result.warnings.map(w => html`<p class="warn">${w}${/Full Disk Access/.test(w) ? html` <button class="link" onClick=${() => invoke('app:openExternal', 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles')}>Open settings</button>` : ''}</p>`)}
      <div class="btns"><button class="gh" onClick=${() => setResult(null)}>Import another</button><button class="pri" onClick=${next}>Continue <${Icon} name="arrow" /></button></div>`
  }

  return html`
    <img class="logo sm" src="../shared/icon.png" />
    <h1>Bring your <em>whole</em><br />browser with you.</h1>
    <p class="lede">Pick where you’re coming from. Your old browser isn’t changed.</p>
    <div class="lbl">Import from</div>
    ${sources === null ? html`<div class="picker">Looking for browsers…</div>` : !sources.length ? html`<div class="picker muted">No other browsers found on this Mac.</div>` : html`
      <div class="dd-wrap">
        <button class="picker" onClick=${() => setOpen(o => !o)} disabled=${!!busy}>
          <span class="bl" style=${`background:${BROWSER_COLORS[sel.browser] || '#777'}`}>${sel.name[0]}</span>
          <b>${sel.name}</b>${sel.multiProfile && html`<span class="muted">· ${sel.profile}</span>`}
          <span class="c"><${Icon} name="chev" /></span>
        </button>
        ${open && html`
          <div class="dd">
            <div class="gh">Found on this Mac</div>
            ${sources.map(s => html`
              <button class=${cls('r', s.id === sel.id && 'on')} onClick=${() => { setSel(s); setOpen(false) }}>
                <span class="bl" style=${`background:${BROWSER_COLORS[s.browser] || '#777'}`}>${s.name[0]}</span>${s.name}
                <small>${s.multiProfile ? s.profile : ''}${s.needsFullDiskAccess ? 'needs Full Disk Access' : ''}</small>
                ${s.id === sel.id && html`<${Icon} name="check" />`}
              </button>`)}
          </div>`}
      </div>
      <div class="chips">
        ${WHAT.filter(([k]) => sel.can[k]).map(([k, label, icon]) => html`
          <button class=${cls('chip', what[k] && 'on')} onClick=${() => setWhat(w => ({ ...w, [k]: !w[k] }))} disabled=${!!busy}>
            <${Icon} name=${what[k] ? 'check' : icon} size=${14} /> ${label}
          </button>`)}
      </div>
      ${(what.passwords || what.cookies) && sel.kind === 'chromium' && html`<p class="note">macOS will ask to let Crescent read “${sel.name} Safe Storage” from your Keychain. Choose <b>Allow</b> so passwords and logins come across.</p>`}`}
    <div class="btns">
      <button class="gh" onClick=${next} disabled=${!!busy}>Skip for now</button>
      <button class="pri" onClick=${run} disabled=${!sel || !!busy}>${busy ? html`<span class="spin"></span> ${busy}` : html`Import <${Icon} name="arrow" />`}</button>
    </div>`
}

function Spaces({ spaces, setSpaces, existing, next, back }) {
  const upd = (i, patch) => setSpaces(list => list.map((s, j) => (j === i ? { ...s, ...patch } : s)))
  const add = (sugg = {}) => setSpaces(list => [...list, { name: sugg.name || '', icon: sugg.icon || ICON_NAMES[list.length % ICON_NAMES.length], colors: PALETTE[(list.length + existing.length) % PALETTE.length] }])
  const names = new Set([...spaces.map(s => s.name), ...existing.map(s => s.name)])
  return html`
    <h1>Make some <em>spaces</em>.</h1>
    <p class="lede">A space is a sidebar for one part of your life, with its own tabs and colour. Swipe with two fingers to move between them.</p>
    ${existing.length > 0 && html`<div class="lbl">Already imported</div><div class="existing">${existing.map(s => html`<span class="chip on"><${Icon} name=${s.icon} size=${14} /> ${s.name}</span>`)}</div>`}
    <div class="spaces">
      ${spaces.map((s, i) => html`
        <div class="sprow" key=${i}>
          <button class="swatch" style=${`background:linear-gradient(135deg,${s.colors[0]},${s.colors[1]})`} title="Change colour"
            onClick=${() => upd(i, { colors: PALETTE[(PALETTE.findIndex(p => p[0] === s.colors[0]) + 1) % PALETTE.length] })}>
            <${Icon} name=${s.icon} size=${15} />
          </button>
          <input value=${s.name} placeholder="Space name" onInput=${e => upd(i, { name: e.target.value })} maxLength=${40} />
          <button class="icn" title="Change icon" onClick=${() => upd(i, { icon: ICON_NAMES[(ICON_NAMES.indexOf(s.icon) + 1) % ICON_NAMES.length] })}><${Icon} name="dots" /></button>
          <button class="icn" title="Remove" onClick=${() => setSpaces(list => list.filter((_, j) => j !== i))}><${Icon} name="x" /></button>
        </div>`)}
      <button class="addrow" onClick=${() => add()}><${Icon} name="plus" /> Add a space</button>
    </div>
    <div class="chips sugg">${SUGGEST.filter(s => !names.has(s.name)).slice(0, 5).map(s => html`<button class="chip" onClick=${() => add(s)}><${Icon} name=${s.icon} size=${14} /> ${s.name}</button>`)}</div>
    <div class="btns"><button class="gh" onClick=${back}>Back</button><button class="pri" onClick=${next} disabled=${!spaces.some(s => s.name.trim()) && !existing.length}>Continue <${Icon} name="arrow" /></button></div>`
}

function Pins({ pinsMode, setPinsMode, engine, setEngine, next, back }) {
  return html`
    <h1>How should <em>pins</em> work?</h1>
    <p class="lede">The icon grid at the top of the sidebar holds the sites you live in. You can switch this any time without losing a pin.</p>
    <div class="opts">
      <button class=${cls('opt', pinsMode === 'global' && 'on')} onClick=${() => setPinsMode('global')}>
        <div class="mini-grid">${[0, 1, 2, 3].map(i => html`<i style=${`background:${['#d4473b', '#3b6fd8', '#1fae5a', '#2b2b2b'][i]}`}></i>`)}</div>
        <b>Same in every space</b><span>Mail, calendar and music follow you everywhere.</span>
      </button>
      <button class=${cls('opt', pinsMode === 'space' && 'on')} onClick=${() => setPinsMode('space')}>
        <div class="mini-grid">${[0, 1, 2, 3].map(i => html`<i style=${`background:${['#7b5ad6', '#c9452e', '#3d8b6e', '#a8743a'][i]}`}></i>`)}</div>
        <b>Different in each space</b><span>School gets Canvas, Personal gets YouTube.</span>
      </button>
    </div>
    <div class="lbl">Search with</div>
    <div class="seg">
      ${[['google', 'Google'], ['duckduckgo', 'DuckDuckGo'], ['brave', 'Brave'], ['bing', 'Bing'], ['kagi', 'Kagi']].map(([k, n]) => html`<button class=${cls(engine === k && 'on')} onClick=${() => setEngine(k)}>${n}</button>`)}
    </div>
    <div class="btns"><button class="gh" onClick=${back}>Back</button><button class="pri" onClick=${next}>Continue <${Icon} name="arrow" /></button></div>`
}

function Default({ isDefault, setIsDefault, finish, back }) {
  useEffect(() => { invoke('default:is').then(setIsDefault) }, [])
  const make = async () => { await invoke('default:set'); setTimeout(() => invoke('default:is').then(setIsDefault), 1500) }
  return html`
    <h1>Make it <em>yours</em>.</h1>
    <p class="lede">Set Crescent as your default browser and links from other apps open in Little Crescent, a small window you can promote to a tab with one click.</p>
    <div class="defbox">
      <img src="../shared/icon.png" />
      <div><b>${isDefault ? 'Crescent is your default browser' : 'Use Crescent for links'}</b><span>${isDefault ? 'Links from Messages, Mail and Slack open here.' : 'macOS will ask you to confirm.'}</span></div>
      ${isDefault ? html`<span class="ok"><${Icon} name="check" /></span>` : html`<button class="sec" onClick=${make}>Set as default</button>`}
    </div>
    <div class="keys">
      <div><kbd>⌘</kbd><kbd>T</kbd> search, open, or run anything</div>
      <div><kbd>⌘</kbd><kbd>S</kbd> hide the sidebar</div>
      <div><kbd>⌃</kbd><kbd>1</kbd>–<kbd>9</kbd> jump to a tab</div>
      <div><kbd>⌘</kbd><kbd>D</kbd> pin the current tab</div>
    </div>
    <div class="btns"><button class="gh" onClick=${back}>Back</button><button class="pri" onClick=${finish}>Start browsing <${Icon} name="arrow" /></button></div>`
}

render(html`<${App} />`, document.getElementById('root'))
