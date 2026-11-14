import { html, render, useState, useEffect, useCrescent, useEvent, invoke, cls, Favicon, timeAgo } from '../shared/ui.js'
import { Icon } from '../shared/icons.js'

const SECTIONS = [
  ['general', 'General', 'gear'], ['tabs', 'Tabs & Pins', 'pin'], ['spaces', 'Spaces', 'moon'], ['privacy', 'Privacy', 'shield'],
  ['passwords', 'Passwords', 'key'], ['extensions', 'Extensions', 'puzzle'], ['import', 'Import', 'down'],
  ['shortcuts', 'Shortcuts', 'bolt'], ['about', 'About', 'star'],
]

function App() {
  const data = useCrescent()
  const [sec, setSec] = useState((location.hash || '#general').slice(1))
  useEvent('settings:section', setSec)
  useEffect(() => { document.documentElement.classList.toggle('mac', window.crescent.platform === 'darwin') }, [])
  useEffect(() => { if (data) document.documentElement.classList.toggle('dark', !!data.state.dark) }, [data && data.state.dark])
  if (!data) return null
  const s = data.state.settings
  const set = (k, v) => invoke('settings:set', k, v)
  const P = { s, set, state: data.state }
  return html`
    <nav>
      <div class="drag"></div>
      ${SECTIONS.map(([id, label, icon]) => html`<button class=${cls(sec === id && 'on')} onClick=${() => setSec(id)}><${Icon} name=${icon} /> ${label}</button>`)}
    </nav>
    <main key=${sec}>
      <div class="drag"></div>
      ${sec === 'general' && html`<${General} ...${P} />`}
      ${sec === 'tabs' && html`<${Tabs} ...${P} />`}
      ${sec === 'spaces' && html`<${Spaces} ...${P} />`}
      ${sec === 'privacy' && html`<${Privacy} ...${P} />`}
      ${sec === 'passwords' && html`<${Passwords} />`}
      ${sec === 'extensions' && html`<${Extensions} />`}
      ${sec === 'import' && html`<${Import} />`}
      ${sec === 'shortcuts' && html`<${Shortcuts} />`}
      ${sec === 'about' && html`<${About} version=${data.version} />`}
    </main>`
}

const Toggle = ({ on, onChange }) => html`<button class=${cls('tog', on && 'on')} onClick=${() => onChange(!on)} role="switch" aria-checked=${on}><i></i></button>`
const Row = ({ title, sub, children }) => html`<div class="row"><div class="rl"><b>${title}</b>${sub && html`<span>${sub}</span>`}</div><div class="rr">${children}</div></div>`
const Seg = ({ value, options, onChange }) => html`<div class="seg">${options.map(([v, l]) => html`<button class=${cls(value === v && 'on')} onClick=${() => onChange(v)}>${l}</button>`)}</div>`

function General({ s, set }) {
  const [isDefault, setDef] = useState(null)
  useEffect(() => { invoke('default:is').then(setDef) }, [])
  return html`
    <h1>General</h1>
    <div class="group">
      <${Row} title="Default browser" sub=${isDefault ? 'Crescent opens links from other apps.' : 'Links from other apps open somewhere else.'}>
        ${isDefault ? html`<span class="ok"><${Icon} name="check" size=${14} /> Default</span>` : html`<button class="btn" onClick=${() => invoke('default:set').then(() => setTimeout(() => invoke('default:is').then(setDef), 1500))}>Make default</button>`}
      </${Row}>
      <${Row} title="Open links from other apps in Little Crescent" sub="A small window you can promote to a tab with one click.">
        <${Toggle} on=${s.littleCrescent} onChange=${v => set('littleCrescent', v)} />
      </${Row}>
      <${Row} title="Search engine">
        <select value=${s.searchEngine} onChange=${e => set('searchEngine', e.target.value)}>
          ${[['google', 'Google'], ['duckduckgo', 'DuckDuckGo'], ['brave', 'Brave Search'], ['bing', 'Bing'], ['kagi', 'Kagi'], ['ecosia', 'Ecosia']].map(([v, l]) => html`<option value=${v}>${l}</option>`)}
        </select>
      </${Row}>
    </div>
    <h2>Downloads</h2>
    <div class="group">
      <${Row} title="Ask where to save each file" sub="Shows the save panel for every download.">
        <${Toggle} on=${s.askWhereToSave} onChange=${v => set('askWhereToSave', v)} />
      </${Row}>
      <${Row} title="Default folder" sub=${s.downloadDir || 'Downloads'}>
        <button class="btn" onClick=${() => invoke('settings:chooseDownloadDir')}>Change…</button>
      </${Row}>
    </div>
    <h2>Sidebar</h2>
    <div class="group">
      <${Row} title="Show link address on hover" sub="At the bottom of the sidebar.">
        <${Toggle} on=${s.showHoverUrl} onChange=${v => set('showHoverUrl', v)} />
      </${Row}>
      <${Row} title="Hide sidebar" sub="Hover the left edge to reveal it. Shortcut: ⌘S">
        <${Toggle} on=${s.sidebarHidden} onChange=${() => invoke('sidebar:toggle')} />
      </${Row}>
    </div>`
}

function Tabs({ s, set }) {
  return html`
    <h1>Tabs & Pins</h1>
    <div class="group">
      <${Row} title="Pinned bar (icon grid)" sub="Switching never deletes pins. Going to per-space copies your pins into every space so you can edit each one.">
        <${Seg} value=${s.pinsMode} options=${[['global', 'Same in every space'], ['space', 'Per space']]} onChange=${v => set('pinsMode', v)} />
      </${Row}>
      <${Row} title="New tabs open" sub="Where new tabs appear in the Today list.">
        <${Seg} value=${s.newTabPosition} options=${[['top', 'At the top'], ['bottom', 'At the bottom']]} onChange=${v => set('newTabPosition', v)} />
      </${Row}>
      <${Row} title="Open links from pinned tabs in Peek" sub="Keeps your pinned app where it is when a link goes to another site. Shift-click any link to Peek.">
        <${Toggle} on=${s.peekForPinned} onChange=${v => set('peekForPinned', v)} />
      </${Row}>
    </div>
    <h2>Performance</h2>
    <div class="group">
      <${Row} title="Unload tabs you haven’t looked at" sub="Frees memory. Tabs playing audio or using your camera are never unloaded. They reload when you click them.">
        <select value=${String(s.memorySaverMinutes)} onChange=${e => set('memorySaverMinutes', Number(e.target.value))}>
          ${[[15, 'After 15 minutes'], [45, 'After 45 minutes'], [120, 'After 2 hours'], [480, 'After 8 hours'], [0, 'Never']].map(([v, l]) => html`<option value=${String(v)}>${l}</option>`)}
        </select>
      </${Row}>
    </div>
    <p class="foot">Closing a tab sends it to the Library archive (⌘Y), so nothing is ever lost. Tabs are never archived automatically.</p>`
}

function Spaces({ state }) {
  return html`
    <h1>Spaces</h1>
    <div class="group">
      ${state.spaces.map((sp, i) => html`
        <div class="row" key=${sp.id}>
          <div class="sw" style=${`background:linear-gradient(135deg,${sp.theme.colors[0]},${sp.theme.colors[sp.theme.colors.length - 1]})`}><${Icon} name=${sp.icon} size=${15} /></div>
          <div class="rl"><input class="name" defaultValue=${sp.name} onChange=${e => invoke('space:update', sp.id, { name: e.target.value })} /><span>⌃⌥${i + 1} · ${sp.theme.mode} · ${countTabs(sp)} tabs</span></div>
          <div class="rr">
            <button class="ib" title="Move up" disabled=${i === 0} onClick=${() => invoke('space:move', sp.id, i - 1)}><${Icon} name="chev" style="transform:rotate(180deg)" /></button>
            <button class="ib" title="Move down" disabled=${i === state.spaces.length - 1} onClick=${() => invoke('space:move', sp.id, i + 1)}><${Icon} name="chev" /></button>
          </div>
        </div>`)}
    </div>
    <div class="actions"><button class="btn" onClick=${() => invoke('space:create')}><${Icon} name="plus" size=${14} /> New space</button></div>
    <p class="foot">Edit a space’s colours from the palette button next to its name in the sidebar, or press ⇧⌘E. Right-click a space icon at the bottom of the sidebar for more.</p>`
}
const countTabs = sp => { let n = 0; const rec = l => l.forEach(x => (x.children ? rec(x.children) : n++)); rec(sp.pinned); rec(sp.today); return n }

function Privacy({ s, set }) {
  const [perms, setPerms] = useState({})
  const [cleared, setCleared] = useState(null)
  const [what, setWhat] = useState({ history: true, cache: true, cookies: false, storage: false })
  useEffect(() => { invoke('permission:list').then(p => setPerms(p || {})) }, [])
  const clear = async () => { await invoke('data:clear', what); setCleared(Date.now()) }
  return html`
    <h1>Privacy</h1>
    <div class="group">
      <${Row} title="Block ads and trackers" sub="Uses AdGuard’s filter lists (Base, Tracking Protection, Annoyances). Pause it for one site from the command bar.">
        <${Toggle} on=${s.adblock} onChange=${v => set('adblock', v)} />
      </${Row}>
    </div>
    <h2>Clear browsing data</h2>
    <div class="group">
      ${[['history', 'History'], ['cache', 'Cached images and files'], ['cookies', 'Cookies (signs you out)'], ['storage', 'Site storage']].map(([k, l]) => html`
        <label class="row chk"><input type="checkbox" checked=${what[k]} onChange=${e => setWhat(w => ({ ...w, [k]: e.target.checked }))} /> ${l}</label>`)}
      <div class="row"><div class="rl"><span>${cleared ? 'Cleared.' : 'This can’t be undone.'}</span></div><div class="rr"><button class="btn danger" onClick=${clear}>Clear data</button></div></div>
    </div>
    <h2>Site permissions</h2>
    <div class="group">
      ${Object.keys(perms).length ? Object.entries(perms).map(([origin, p]) => html`
        <div class="row" key=${origin}>
          <${Favicon} url=${origin} size=${18} />
          <div class="rl"><b>${origin.replace(/^https?:\/\//, '')}</b><span>${Object.entries(p).map(([k, v]) => `${k.replace('media:', '')} ${v ? 'allowed' : 'blocked'}`).join(' · ')}</span></div>
          <div class="rr"><button class="btn" onClick=${() => invoke('permission:reset', origin).then(() => invoke('permission:list').then(setPerms))}>Reset</button></div>
        </div>`) : html`<div class="row"><span class="muted">No sites have asked for permissions yet.</span></div>`}
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
      <input class="search" placeholder="Search" value=${q} onInput=${e => setQ(e.target.value)} />
      <button class="btn" onClick=${() => load(!revealed)}>${revealed ? 'Hide passwords' : 'Show passwords'}</button>
      <button class="btn" onClick=${async () => { try { const n = await invoke('import:passwordsCsv'); if (n !== null) { setMsg(`Imported ${n} passwords.`); load(revealed) } } catch (e) { setMsg(String(e)) } }}>Import CSV…</button>
    </div>
    ${msg && html`<p class="foot">${msg}</p>`}
    <div class="group">
      ${list === null ? html`<div class="row muted">Loading…</div>` : !shown.length ? html`<div class="row muted">${q ? 'No matches.' : 'No saved passwords yet. Import them from your old browser, or sign in to a site and Crescent will offer to save.'}</div>` :
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
    <p class="sub">Install anything from the Chrome Web Store: open it, pick an extension, and click “Add to Chrome”.</p>
    <div class="actions"><button class="btn pri" onClick=${() => invoke('ext:store')}><${Icon} name="puzzle" size=${14} /> Open Chrome Web Store</button></div>
    <div class="group">
      ${list === null ? html`<div class="row muted">Loading…</div>` : !list.length ? html`<div class="row muted">No extensions yet.</div>` : list.map(e => html`
        <div class="row" key=${e.id}>
          ${e.icon ? html`<img class="eicon" src=${e.icon} />` : html`<div class="eicon ph"><${Icon} name="puzzle" size=${16} /></div>`}
          <div class="rl"><b>${e.name}</b><span>${e.version}${e.description ? ' · ' + e.description : ''}</span></div>
          <div class="rr">
            ${e.options && e.enabled && html`<button class="btn" onClick=${() => invoke('ext:options', e.id)}>Options</button>`}
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
    <p class="sub">Bring bookmarks, history, passwords, logins, extensions, and Arc or Zen spaces from another browser.</p>
    ${sources === null ? html`<p class="muted">Looking…</p>` : !sources.length ? html`<p class="muted">No other browsers found.</p>` : html`
      <div class="group">
        <${Row} title="Import from">
          <select value=${sel} onChange=${e => setSel(e.target.value)}>${sources.map(s => html`<option value=${s.id}>${s.name}${s.multiProfile ? ' · ' + s.profile : ''}</option>`)}</select>
        </${Row}>
        ${src && [['spaces', 'Spaces & pinned tabs'], ['bookmarks', 'Bookmarks'], ['history', 'History'], ['passwords', 'Passwords'], ['cookies', 'Stay signed in (cookies)'], ['extensions', 'Extensions']]
          .filter(([k]) => src.can[k]).map(([k, l]) => html`<label class="row chk"><input type="checkbox" checked=${what[k]} onChange=${e => setWhat(w => ({ ...w, [k]: e.target.checked }))} /> ${l}</label>`)}
      </div>
      <div class="actions"><button class="btn pri" onClick=${run} disabled=${!!busy}>${busy || 'Import'}</button></div>`}
    ${res && html`<div class="group result">
      <div class="row"><b>Done.</b> ${[res.spaces && `${res.spaces} spaces`, res.bookmarks && `${res.bookmarks} bookmarks`, res.history && `${res.history} history entries`, res.passwords && `${res.passwords} passwords`, res.cookies && `${res.cookies} cookies`, res.extensions && `${res.extensions} extensions`].filter(Boolean).join(', ') || 'Nothing new.'}</div>
      ${(res.warnings || []).map(w => html`<div class="row warn">${w}</div>`)}
      ${res.error && html`<div class="row warn">${res.error}</div>`}
    </div>`}
    <h2>Passwords from a file</h2>
    <div class="group"><${Row} title="Import passwords from CSV" sub="Works with exports from Safari, Firefox, Zen, 1Password and Bitwarden."><button class="btn" onClick=${() => invoke('import:passwordsCsv').then(n => n !== null && setRes({ passwords: n }))}>Choose file…</button></${Row}></div>`
}

const KEYS = [
  ['Command bar / new tab', '⌘T'], ['Edit current URL', '⌘L'], ['Close tab (pinned tabs stay)', '⌘W'], ['Reopen closed tab', '⇧⌘T'],
  ['Go to tab 1–8 (skips pinned)', '⌃1 … ⌃8'], ['Go to last tab', '⌃9'], ['Next / previous tab', '⌃⇥ / ⌃⇧⇥'],
  ['Next / previous space', '⌥⌘→ / ⌥⌘←'], ['Go to space 1–9', '⌃⌥1 … ⌃⌥9'], ['Swipe between spaces', 'two fingers on sidebar'],
  ['Pin / unpin tab', '⌘D'], ['Add to pinned bar', '⇧⌘D'], ['Split view', '⌃⇧='], ['Toggle sidebar', '⌘S'],
  ['Copy URL', '⇧⌘C'], ['Find on page', '⌘F'], ['Bookmarks', '⌥⌘B'], ['Bookmark page', '⌥⌘D'], ['Library', '⌘Y'], ['Downloads', '⇧⌘J'],
  ['Edit theme', '⇧⌘E'], ['New space', '⇧⌘S'], ['Little Crescent', '⌥⌘N'], ['Private window', '⇧⌘N'], ['Clear unpinned tabs', '⇧⌘⌫'],
  ['Peek a link', 'Shift-click'], ['Open in background', '⌘-click'], ['Developer tools', '⌥⌘I'], ['Settings', '⌘,'],
]
const Shortcuts = () => html`<h1>Shortcuts</h1><div class="group keys">${KEYS.map(([a, k]) => html`<div class="row"><div class="rl"><b>${a}</b></div><div class="rr"><span class="kb">${k}</span></div></div>`)}</div>`

function About({ version }) {
  const [info, setInfo] = useState({})
  useEffect(() => { invoke('app:info').then(setInfo) }, [])
  return html`
    <div class="about">
      <img src="../shared/icon.png" />
      <h1>Crescent</h1>
      <p class="sub">Version ${info.version || version} · Chromium ${info.chrome || ''} · ${info.arch || ''}</p>
      <div class="actions center"><button class="btn" onClick=${() => invoke('app:checkUpdate')}>Check for updates</button></div>
      <p class="foot">No AI, no accounts, no telemetry. Your tabs and data stay on this Mac.</p>
    </div>`
}

render(html`<${App} />`, document.getElementById('root'))
