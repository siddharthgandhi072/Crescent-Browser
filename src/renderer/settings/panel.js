// Settings, shown as a sheet inside the main window (overlay mode 'settings').
import { html, useState, useEffect, useRef, useEvent, invoke, cls, Favicon } from '../shared/ui.js'
import { Icon } from '../shared/icons.js'

const SECTIONS = [
  ['general', 'General', 'gear'], ['appearance', 'Appearance', 'palette'], ['tabs', 'Tabs & Pins', 'pin'],
  ['spaces', 'Spaces', 'moon'], ['atc', 'Air Traffic Control', 'route'], ['focus', 'Focus', 'target'],
  ['privacy', 'Privacy', 'shield'], ['passwords', 'Passwords', 'key'], ['extensions', 'Extensions', 'puzzle'],
  ['import', 'Import', 'down'], ['shortcuts', 'Shortcuts', 'bolt'], ['about', 'Updates & About', 'star'],
]

export function SettingsPanel({ state, section, close }) {
  const [sec, setSec] = useState(section || 'general')
  useEffect(() => { if (section) setSec(section) }, [section])
  const s = state.settings
  const set = (k, v) => invoke('settings:set', k, v)
  const P = { s, set, state }
  return html`
    <div class="stg">
      <nav>
        <div class="sm-title">Settings</div>
        ${SECTIONS.map(([id, label, icon]) => html`<button class=${cls(sec === id && 'on')} onClick=${() => setSec(id)}><${Icon} name=${icon} size=${15} /> ${label}</button>`)}
      </nav>
      <main key=${sec}>
        <button class="sm-close" title="Close (Esc)" onClick=${close}><${Icon} name="x" /></button>
        ${sec === 'general' && html`<${General} ...${P} />`}
        ${sec === 'appearance' && html`<${Appearance} ...${P} />`}
        ${sec === 'tabs' && html`<${Tabs} ...${P} />`}
        ${sec === 'spaces' && html`<${Spaces} ...${P} />`}
        ${sec === 'atc' && html`<${Atc} ...${P} />`}
        ${sec === 'focus' && html`<${FocusSettings} ...${P} />`}
        ${sec === 'privacy' && html`<${Privacy} ...${P} />`}
        ${sec === 'passwords' && html`<${Passwords} />`}
        ${sec === 'extensions' && html`<${Extensions} />`}
        ${sec === 'import' && html`<${Import} />`}
        ${sec === 'shortcuts' && html`<${Shortcuts} />`}
        ${sec === 'about' && html`<${About} />`}
      </main>
    </div>`
}

const Toggle = ({ on, onChange }) => html`<button class=${cls('tog', on && 'on')} onClick=${() => onChange(!on)} role="switch" aria-checked=${on}><i></i></button>`
const Row = ({ title, sub, children }) => html`<div class="row"><div class="rl"><b>${title}</b>${sub && html`<span>${sub}</span>`}</div><div class="rr">${children}</div></div>`
const Seg = ({ value, options, onChange }) => html`<div class="seg">${options.map(([v, l]) => html`<button class=${cls(String(value) === String(v) && 'on')} onClick=${() => onChange(v)}>${l}</button>`)}</div>`
const Slider = ({ value, min, max, step, onChange, fmt }) => html`<div class="slide"><input type="range" min=${min} max=${max} step=${step} value=${value} onInput=${e => onChange(Number(e.target.value))} /><span>${fmt ? fmt(value) : value}</span></div>`

function General({ s, set }) {
  const [isDefault, setDef] = useState(null)
  useEffect(() => { invoke('default:is').then(setDef) }, [])
  return html`
    <h1>General</h1>
    <div class="group">
      <${Row} title="Default browser" sub=${isDefault ? 'Links from other apps open in Crescent.' : 'Links from other apps open somewhere else.'}>
        ${isDefault ? html`<span class="ok"><${Icon} name="check" size=${14} /> Default</span>` : html`<button class="btn" onClick=${() => invoke('default:set').then(() => setTimeout(() => invoke('default:is').then(setDef), 1500))}>Make default</button>`}
      </${Row}>
      <${Row} title="Links from other apps" sub="Little Crescent is a small window you can turn into a tab with one click.">
        <${Seg} value=${s.littleCrescent} options=${[[true, 'Little Crescent'], [false, 'New tab']]} onChange=${v => set('littleCrescent', v)} />
      </${Row}>
      <${Row} title="Search engine">
        <select value=${s.searchEngine} onChange=${e => set('searchEngine', e.target.value)}>
          ${[['google', 'Google'], ['duckduckgo', 'DuckDuckGo'], ['brave', 'Brave Search'], ['bing', 'Bing'], ['kagi', 'Kagi'], ['ecosia', 'Ecosia'], ['custom', 'Custom…']].map(([v, l]) => html`<option value=${v}>${l}</option>`)}
        </select>
      </${Row}>
      ${s.searchEngine === 'custom' && html`<${Row} title="Custom search URL" sub="Use %s where the search goes, e.g. https://example.com/search?q=%s">
        <input class="txt" placeholder="https://…?q=%s" defaultValue=${s.customSearchUrl} onChange=${e => set('customSearchUrl', e.target.value.trim())} />
      </${Row}>`}
      <${Row} title="Ask before quitting" sub="Press ⌘Q twice to quit, so a stray ⌘Q never closes everything.">
        <${Toggle} on=${s.warnBeforeQuit} onChange=${v => set('warnBeforeQuit', v)} />
      </${Row}>
    </div>
    <h2>Downloads</h2>
    <div class="group">
      <${Row} title="Ask where to save each file"><${Toggle} on=${s.askWhereToSave} onChange=${v => set('askWhereToSave', v)} /></${Row}>
      <${Row} title="Default folder" sub=${s.downloadDir || 'Downloads'}><button class="btn" onClick=${() => invoke('settings:chooseDownloadDir')}>Change…</button></${Row}>
    </div>`
}

function Appearance({ s, set }) {
  const live = (k, v) => set(k, v).then(() => invoke('appearance:apply'))
  return html`
    <h1>Appearance</h1>
    <p class="sub">Colours are set per space. Click the palette next to a space’s name, or press ⇧⌘E.</p>
    <div class="group">
      <${Row} title="Interface font">
        <${Seg} value=${s.uiFont} options=${[['crescent', 'Crescent'], ['system', 'System'], ['rounded', 'Rounded'], ['mono', 'Mono']]} onChange=${v => set('uiFont', v)} />
      </${Row}>
      <${Row} title="Sidebar density">
        <${Seg} value=${s.density} options=${[['compact', 'Compact'], ['comfortable', 'Comfortable'], ['roomy', 'Roomy']]} onChange=${v => set('density', v)} />
      </${Row}>
      <${Row} title="Sidebar glass" sub="How much of your desktop shows through.">
        <${Slider} value=${s.glass} min=${0.5} max=${1} step=${0.02} onChange=${v => set('glass', v)} fmt=${v => Math.round((1 - v) * 200) + '%'} />
      </${Row}>
      <${Row} title="Pinned bar columns"><${Seg} value=${s.gridColumns} options=${[[3, '3'], [4, '4'], [5, '5'], [6, '6']]} onChange=${v => set('gridColumns', v)} /></${Row}>
      <${Row} title="Page corners"><${Slider} value=${s.pageRadius} min=${0} max=${16} step=${1} onChange=${v => live('pageRadius', v)} fmt=${v => v + ' px'} /></${Row}>
      <${Row} title="Space around pages"><${Slider} value=${s.frameGap} min=${0} max=${16} step=${1} onChange=${v => live('frameGap', v)} fmt=${v => v + ' px'} /></${Row}>
      <${Row} title="Close buttons on tabs"><${Seg} value=${s.showCloseButtons} options=${[['hover', 'On hover'], ['always', 'Always']]} onChange=${v => set('showCloseButtons', v)} /></${Row}>
      <${Row} title="Animations"><${Toggle} on=${s.animations !== false} onChange=${v => set('animations', v)} /></${Row}>
      <${Row} title="Link address on hover" sub="Shown at the bottom of the sidebar."><${Toggle} on=${s.showHoverUrl} onChange=${v => set('showHoverUrl', v)} /></${Row}>
    </div>`
}

function Tabs({ s, set }) {
  return html`
    <h1>Tabs & Pins</h1>
    <div class="group">
      <${Row} title="Pinned bar" sub="Switching never deletes pins. Per-space copies your pins into each space so you can edit them separately.">
        <${Seg} value=${s.pinsMode} options=${[['global', 'Same everywhere'], ['space', 'Per space']]} onChange=${v => set('pinsMode', v)} />
      </${Row}>
      <${Row} title="New tabs open"><${Seg} value=${s.newTabPosition} options=${[['top', 'At the top'], ['bottom', 'At the bottom']]} onChange=${v => set('newTabPosition', v)} /></${Row}>
      <${Row} title="Switch to a tab that’s already open" sub="Typing a URL you already have open takes you to it instead of opening a copy.">
        <${Toggle} on=${s.duplicateTabGuard} onChange=${v => set('duplicateTabGuard', v)} />
      </${Row}>
      <${Row} title="Dot on tabs you haven’t looked at" sub="For tabs opened in the background."><${Toggle} on=${s.unreadDots} onChange=${v => set('unreadDots', v)} /></${Row}>
      <${Row} title="Hover previews" sub="Rest the pointer on a tab to see the page."><${Toggle} on=${s.tabPreviews} onChange=${v => set('tabPreviews', v)} /></${Row}>
      <${Row} title="Open links from pinned tabs in Peek" sub="Shift-click any link to Peek."><${Toggle} on=${s.peekForPinned} onChange=${v => set('peekForPinned', v)} /></${Row}>
    </div>
    <h2>Media</h2>
    <div class="group">
      <${Row} title="Media controls in the sidebar" sub="Play/pause for music or video in other tabs."><${Toggle} on=${s.mediaControls} onChange=${v => set('mediaControls', v)} /></${Row}>
      <${Row} title="Picture in picture when you switch away" sub="Playing videos keep going in a floating window."><${Toggle} on=${s.autoPip} onChange=${v => set('autoPip', v)} /></${Row}>
    </div>
    <h2>Memory</h2>
    <div class="group">
      <${Row} title="Unload tabs you haven’t looked at" sub="Tabs playing audio or using the camera are never unloaded.">
        <select value=${String(s.memorySaverMinutes)} onChange=${e => set('memorySaverMinutes', Number(e.target.value))}>
          ${[[15, 'After 15 minutes'], [45, 'After 45 minutes'], [120, 'After 2 hours'], [480, 'After 8 hours'], [0, 'Never']].map(([v, l]) => html`<option value=${String(v)}>${l}</option>`)}
        </select>
      </${Row}>
    </div>`
}

function Spaces({ state }) {
  const spaces = state.spaces.filter(s => !s.private)
  return html`
    <h1>Spaces</h1>
    <div class="group">
      ${spaces.map((sp, i) => html`
        <div class="row" key=${sp.id}>
          <div class="sw" style=${`background:linear-gradient(135deg,${sp.theme.colors[0]},${sp.theme.colors[sp.theme.colors.length - 1]})`}><${Icon} name=${sp.icon} size=${15} /></div>
          <div class="rl"><input class="name" defaultValue=${sp.name} onChange=${e => invoke('space:update', sp.id, { name: e.target.value })} /><span>⌃⌥${i + 1}</span></div>
          <div class="rr">
            <button class="ib" title="Move up" disabled=${i === 0} onClick=${() => invoke('space:move', sp.id, i - 1)}><${Icon} name="chev" style="transform:rotate(180deg)" /></button>
            <button class="ib" title="Move down" disabled=${i === spaces.length - 1} onClick=${() => invoke('space:move', sp.id, i + 1)}><${Icon} name="chev" /></button>
            <button class="ib" title="Colours" onClick=${() => { invoke('space:switch', sp.id).then(() => invoke('space:theme')) }}><${Icon} name="palette" /></button>
            <button class="ib" title="More" onClick=${() => invoke('space:menu', sp.id)}><${Icon} name="dots" /></button>
          </div>
        </div>`)}
    </div>
    <div class="actions">
      <button class="btn" onClick=${() => invoke('space:create')}><${Icon} name="plus" size=${14} /> New space</button>
      <button class="btn" onClick=${() => invoke('space:private')}><${Icon} name="incognito" size=${14} /> Private space</button>
    </div>
    <p class="foot">Private space: tabs use a separate, in-memory session with no history, archive or saved cookies. Everything is wiped when you quit or press End.</p>`
}

function Atc({ s, state }) {
  const [rules, setRules] = useState(s.airTraffic || [])
  const spaces = state.spaces.filter(x => !x.private)
  const save = r => { setRules(r); invoke('atc:set', r) }
  const upd = (i, patch) => save(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  return html`
    <h1>Air Traffic Control</h1>
    <p class="sub">Send links from other apps straight to the right space. Rules are checked top to bottom; anything that doesn’t match opens in Little Crescent.</p>
    <div class="group">
      ${!rules.length && html`<div class="row muted">No rules yet.</div>`}
      ${rules.map((r, i) => html`
        <div class="row atc" key=${r.id || i}>
          <div class="atc-f"><label>Link contains</label><input class="txt" placeholder="e.g. figma.com" value=${r.url} onChange=${e => upd(i, { url: e.target.value })} /></div>
          <div class="atc-f"><label>From app</label><input class="txt" placeholder="any app (e.g. Slack)" value=${r.app} onChange=${e => upd(i, { app: e.target.value })} /></div>
          <div class="atc-f"><label>Open in</label><select value=${r.spaceId || ''} onChange=${e => upd(i, { spaceId: e.target.value })}>${spaces.map(sp => html`<option value=${sp.id}>${sp.name}</option>`)}</select></div>
          <button class="ib" title="Remove rule" onClick=${() => save(rules.filter((_, j) => j !== i))}><${Icon} name="trash" size=${15} /></button>
        </div>`)}
    </div>
    <div class="actions"><button class="btn" onClick=${() => save([...rules, { url: '', app: '', spaceId: spaces[0] && spaces[0].id }])}><${Icon} name="plus" size=${14} /> Add rule</button></div>`
}

function FocusSettings({ s }) {
  return html`
    <h1>Focus</h1>
    <p class="sub">Start a session from the target button at the top of the sidebar, or ⇧⌘F. Crescent goes full screen, searches still work, and only the sites and words you allow can open until the timer ends. Holding Stop for 5 seconds ends early.</p>
    <div class="group">
      <${Row} title="Usual length"><span class="muted">${s.focusMinutes} minutes</span></${Row}>
      <${Row} title="Allowed sites"><span class="muted wrap">${(s.focusSites || []).join(', ') || 'None'}</span></${Row}>
      <${Row} title="Allowed words"><span class="muted wrap">${(s.focusWords || []).join(', ') || 'None'}</span></${Row}>
    </div>
    <div class="actions"><button class="btn pri" onClick=${() => invoke('focus:open')}><${Icon} name="target" size=${14} /> Start a focus session</button></div>`
}

function Privacy({ s, set }) {
  const [perms, setPerms] = useState({})
  const [cleared, setCleared] = useState(null)
  const [what, setWhat] = useState({ history: true, cache: true, cookies: false, storage: false })
  useEffect(() => { invoke('permission:list').then(p => setPerms(p || {})) }, [])
  return html`
    <h1>Privacy</h1>
    <div class="group">
      <${Row} title="Block ads and trackers" sub="Uses AdGuard’s filter lists. Pause it for one site from the command bar.">
        <${Toggle} on=${s.adblock} onChange=${v => set('adblock', v)} />
      </${Row}>
      <${Row} title="Global Privacy Control" sub="Tells sites not to sell or share your data. Legally binding in some places.">
        <${Toggle} on=${s.globalPrivacyControl !== false} onChange=${v => set('globalPrivacyControl', v)} />
      </${Row}>
    </div>
    <h2>Clear browsing data</h2>
    <div class="group">
      ${[['history', 'History'], ['cache', 'Cached images and files'], ['cookies', 'Cookies (signs you out)'], ['storage', 'Site storage']].map(([k, l]) => html`
        <label class="row chk"><input type="checkbox" checked=${what[k]} onChange=${e => setWhat(w => ({ ...w, [k]: e.target.checked }))} /> ${l}</label>`)}
      <div class="row"><div class="rl"><span>${cleared ? 'Cleared.' : 'This can’t be undone.'}</span></div><div class="rr"><button class="btn danger" onClick=${async () => { await invoke('data:clear', what); setCleared(Date.now()) }}>Clear data</button></div></div>
    </div>
    <h2>Site permissions</h2>
    <div class="group">
      ${Object.keys(perms).length ? Object.entries(perms).map(([origin, p]) => html`
        <div class="row" key=${origin}>
          <${Favicon} url=${origin} size=${18} />
          <div class="rl"><b>${origin.replace(/^https?:\/\//, '')}</b><span>${Object.entries(p).map(([k, v]) => `${k.replace('media:', '')} ${v ? 'allowed' : 'blocked'}`).join(' · ')}</span></div>
          <div class="rr"><button class="btn" onClick=${() => invoke('permission:reset', origin).then(() => invoke('permission:list').then(setPerms))}>Reset</button></div>
        </div>`) : html`<div class="row muted">No site has asked for anything yet.</div>`}
    </div>`
}

function Passwords() {
  const [list, setList] = useState(null)
  const [revealed, setRevealed] = useState(false)
  const [q, setQ] = useState('')
  const [msg, setMsg] = useState(null)
  const load = reveal => invoke('passwords:list', reveal).then(r => { if (r && r.locked) return; setList(r); setRevealed(!!reveal) })
  useEffect(() => { load(false) }, [])
  const shown = (list || []).filter(p => !q || (p.origin + p.username).toLowerCase().includes(q.toLowerCase()))
  return html`
    <h1>Passwords</h1>
    <p class="sub">Encrypted with your macOS Keychain. Crescent fills them in when you click a login field.</p>
    <div class="actions">
      <input class="txt grow" placeholder="Search" value=${q} onInput=${e => setQ(e.target.value)} />
      <button class="btn" onClick=${() => load(!revealed)}>${revealed ? 'Hide' : 'Show'}</button>
      <button class="btn" onClick=${async () => { try { const n = await invoke('import:passwordsCsv'); if (n !== null) { setMsg(`Imported ${n} passwords.`); load(revealed) } } catch (e) { setMsg(String(e)) } }}>Import CSV…</button>
    </div>
    ${msg && html`<p class="foot">${msg}</p>`}
    <div class="group">
      ${list === null ? html`<div class="row muted">Loading…</div>` : !shown.length ? html`<div class="row muted">${q ? 'No matches.' : 'Nothing saved yet.'}</div>` :
        shown.map(p => html`
          <div class="row" key=${p.id}>
            <${Favicon} url=${p.origin} size=${18} />
            <div class="rl"><b>${p.origin.replace(/^https?:\/\//, '')}</b><span>${p.username || '(no username)'}</span></div>
            <div class="rr">
              <code class=${cls('pw', !revealed && 'hidden')} onClick=${() => revealed && navigator.clipboard.writeText(p.password)} title=${revealed ? 'Click to copy' : ''}>${revealed ? p.password : '••••••••••'}</code>
              <button class="ib" title="Delete" onClick=${() => invoke('passwords:remove', p.id).then(() => load(revealed))}><${Icon} name="trash" size=${15} /></button>
            </div>
          </div>`)}
    </div>`
}

function Extensions() {
  const [list, setList] = useState(null)
  const load = () => invoke('ext:list').then(setList)
  useEffect(() => { load() }, [])
  useEvent('extensions', load)
  return html`
    <h1>Extensions</h1>
    <p class="sub">Open the Chrome Web Store, pick an extension and click “Add to Chrome”.</p>
    <div class="actions"><button class="btn pri" onClick=${() => invoke('ext:store').then(() => invoke('overlay:close'))}><${Icon} name="puzzle" size=${14} /> Chrome Web Store</button></div>
    <div class="group">
      ${list === null ? html`<div class="row muted">Loading…</div>` : !list.length ? html`<div class="row muted">No extensions yet.</div>` : list.map(e => html`
        <div class="row" key=${e.id}>
          ${e.icon ? html`<img class="eicon" src=${e.icon} />` : html`<div class="eicon ph"><${Icon} name="puzzle" size=${16} /></div>`}
          <div class="rl"><b>${e.name}</b><span>${e.version}${e.description ? ' · ' + e.description : ''}</span></div>
          <div class="rr">
            ${e.options && e.enabled && html`<button class="btn" onClick=${() => invoke('ext:options', e.id).then(() => invoke('overlay:close'))}>Options</button>`}
            <${Toggle} on=${e.enabled} onChange=${v => invoke('ext:toggle', e.id, v).then(load)} />
            <button class="ib" title="Remove" onClick=${() => invoke('ext:remove', e.id).then(load)}><${Icon} name="trash" size=${15} /></button>
          </div>
        </div>`)}
    </div>`
}

function Import() {
  const [sources, setSources] = useState(null)
  const [sel, setSel] = useState('')
  const [what, setWhat] = useState({ spaces: true, bookmarks: true, history: true, passwords: true, cookies: true, extensions: true })
  const [busy, setBusy] = useState(null)
  const [res, setRes] = useState(null)
  useEffect(() => { invoke('import:detect').then(l => { setSources(l || []); if (l && l[0]) setSel(l[0].id) }) }, [])
  useEvent('import:progress', p => setBusy(p.step))
  const src = sources && sources.find(s => s.id === sel)
  const run = async () => {
    setRes(null); setBusy('Starting…')
    const r = await invoke('import:run', sel, Object.fromEntries(Object.entries(what).filter(([k]) => src.can[k])))
    setBusy(null); setRes(r)
  }
  return html`
    <h1>Import</h1>
    ${sources === null ? html`<p class="muted">Looking…</p>` : !sources.length ? html`<p class="muted">No other browsers found.</p>` : html`
      <div class="group">
        <${Row} title="From">
          <select value=${sel} onChange=${e => setSel(e.target.value)}>${sources.map(s => html`<option value=${s.id}>${s.name}${s.multiProfile ? ' · ' + s.profile : ''}</option>`)}</select>
        </${Row}>
        ${src && [['spaces', 'Spaces & pinned tabs'], ['bookmarks', 'Bookmarks'], ['history', 'History'], ['passwords', 'Passwords'], ['cookies', 'Stay signed in'], ['extensions', 'Extensions']]
          .filter(([k]) => src.can[k]).map(([k, l]) => html`<label class="row chk"><input type="checkbox" checked=${what[k]} onChange=${e => setWhat(w => ({ ...w, [k]: e.target.checked }))} /> ${l}</label>`)}
      </div>
      <div class="actions"><button class="btn pri" onClick=${run} disabled=${!!busy}>${busy || 'Import'}</button></div>`}
    ${res && html`<div class="group">
      <div class="row"><b>Done.</b> ${[res.spaces && `${res.spaces} spaces`, res.bookmarks && `${res.bookmarks} bookmarks`, res.history && `${res.history} history entries`, res.passwords && `${res.passwords} passwords`, res.cookies && `${res.cookies} cookies`, res.extensions && `${res.extensions} extensions`].filter(Boolean).join(', ') || 'Nothing new.'}</div>
      ${(res.warnings || []).map(w => html`<div class="row warn">${w}</div>`)}
      ${res.error && html`<div class="row warn">${res.error}</div>`}
    </div>`}
    <h2>Passwords from a file</h2>
    <div class="group"><${Row} title="Import passwords from CSV" sub="Exports from Safari, Firefox, Zen, 1Password or Bitwarden."><button class="btn" onClick=${() => invoke('import:passwordsCsv').then(n => n !== null && setRes({ passwords: n }))}>Choose file…</button></${Row}></div>`
}

// Turns a keydown into an Electron accelerator string.
function toAccel(e) {
  const mods = []
  if (e.metaKey) mods.push('CmdOrCtrl')
  if (e.ctrlKey) mods.push('Ctrl')
  if (e.altKey) mods.push('Alt')
  if (e.shiftKey) mods.push('Shift')
  const c = e.code
  let key = null
  if (/^Key[A-Z]$/.test(c)) key = c.slice(3)
  else if (/^Digit\d$/.test(c)) key = c.slice(5)
  else if (/^F\d{1,2}$/.test(c)) key = c
  else key = { ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down', Backspace: 'Backspace', Tab: 'Tab', Space: 'Space', Enter: 'Return', Equal: '=', Minus: '-', BracketLeft: '[', BracketRight: ']', Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", Backquote: '`', Backslash: '\\' }[c] || null
  if (!key) return null
  if (!mods.length && !/^F\d/.test(key)) return null
  return [...mods, key].join('+')
}

function Shortcuts() {
  const [list, setList] = useState([])
  const [rec, setRec] = useState(null)
  const [q, setQ] = useState('')
  const load = () => invoke('shortcuts:list').then(setList)
  useEffect(() => { load() }, [])
  useEffect(() => {
    if (!rec) return
    invoke('shortcuts:recording', true)
    const onKey = e => {
      e.preventDefault(); e.stopPropagation()
      if (e.key === 'Escape') { setRec(null); return }
      if (['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) return
      const a = toAccel(e)
      if (!a) return
      invoke('shortcuts:set', rec, a).then(() => { setRec(null); load() })
    }
    window.addEventListener('keydown', onKey, true)
    return () => { window.removeEventListener('keydown', onKey, true); invoke('shortcuts:recording', false) }
  }, [rec])
  const groups = {}
  for (const s of list.filter(x => !q || x.label.toLowerCase().includes(q.toLowerCase()))) (groups[s.group] = groups[s.group] || []).push(s)
  return html`
    <h1>Shortcuts</h1>
    <p class="sub">Click a shortcut, then press the keys you want. If they’re already used, the other command gives them up.</p>
    <div class="actions"><input class="txt grow" placeholder="Search commands" value=${q} onInput=${e => setQ(e.target.value)} /></div>
    ${Object.entries(groups).map(([g, items]) => html`
      <h2>${g}</h2>
      <div class="group keys">
        ${items.map(s => html`
          <div class="row" key=${s.id}>
            <div class="rl"><b>${s.label}</b></div>
            <div class="rr">
              ${s.accel !== s.default && html`<button class="link" onClick=${() => invoke('shortcuts:set', s.id, null).then(load)}>Reset</button>`}
              <button class=${cls('kb', rec === s.id && 'rec')} onClick=${() => setRec(rec === s.id ? null : s.id)}>${rec === s.id ? 'Press keys…' : s.pretty || 'None'}</button>
            </div>
          </div>`)}
      </div>`)}
    <h2>Mouse and trackpad</h2>
    <div class="group keys">
      ${[['Swipe between spaces', 'Two fingers sideways on the sidebar'], ['Peek a link', 'Shift-click'], ['Open in background', '⌘-click'], ['Split two tabs', 'Drag a tab onto another'], ['Move a tab to a space', 'Drag it onto the space icon']].map(([a, k]) => html`<div class="row"><div class="rl"><b>${a}</b></div><div class="rr"><span class="muted">${k}</span></div></div>`)}
    </div>`
}

function About() {
  const [info, setInfo] = useState({})
  const [u, setU] = useState(null)
  useEffect(() => { invoke('app:info').then(setInfo); invoke('update:status').then(setU) }, [])
  useEvent('update', setU)
  const status = !u ? '' : u.state === 'checking' ? 'Checking…' : u.state === 'downloading' ? `Downloading ${u.version} (${Math.round((u.progress || 0) * 100)}%)` : u.state === 'ready' ? `Version ${u.version} is ready` : u.state === 'manual' ? `Version ${u.version} is available` : u.state === 'error' ? `Couldn’t check: ${u.error}` : 'You’re up to date'
  return html`
    <div class="about">
      <img src="../shared/icon.png" />
      <h1>Crescent</h1>
      <p class="sub">Version ${info.version || ''} · Chromium ${info.chrome || ''} · ${info.arch || ''}</p>
      <p class="status">${status}</p>
      <div class="actions center">
        ${u && (u.state === 'ready' || u.state === 'manual')
          ? html`<button class="btn pri" onClick=${() => invoke('update:install')}>${u.state === 'ready' ? 'Restart to update' : 'Download'}</button>`
          : html`<button class="btn" onClick=${() => invoke('app:checkUpdate')}>Check for updates</button>`}
      </div>
      <p class="foot">Updates download in the background and install when you restart. No accounts, no telemetry, no AI.</p>
    </div>`
}
