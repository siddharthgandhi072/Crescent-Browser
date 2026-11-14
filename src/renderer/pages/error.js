const q = new URLSearchParams(location.search)
const url = q.get('url') || ''
const code = Number(q.get('code'))
let host = url
try { host = new URL(url).host } catch {}
const msgs = {
  '-105': ['Can’t find this site', `Crescent couldn’t find ${host}. Check the spelling, or search for it instead.`],
  '-106': ['You’re offline', 'Check your Wi-Fi or network connection, then try again.'],
  '-109': ['Can’t reach this site', `${host} isn’t responding right now.`],
  '-102': ['Connection refused', `${host} refused to connect. If it’s a local server, make sure it’s running.`],
  '-118': ['This is taking too long', `${host} took too long to respond.`],
  '-7': ['This is taking too long', `${host} took too long to respond.`],
  '-200': ['Connection isn’t private', `The certificate for ${host} isn’t valid, so Crescent stopped before sending anything.`],
  '-201': ['Connection isn’t private', `${host}’s certificate has expired or your Mac’s clock is wrong.`],
  '-202': ['Connection isn’t private', `${host}’s certificate isn’t trusted.`],
}
const m = msgs[String(code)] || (code <= -200 && code > -300 ? msgs['-200'] : null)
if (m) { document.getElementById('t').textContent = m[0]; document.getElementById('d').textContent = m[1] }
else document.getElementById('d').textContent = `Something went wrong opening ${host}.`
document.title = document.getElementById('t').textContent
document.getElementById('c').textContent = (q.get('desc') || '') + (url ? ' · ' + url : '')
document.getElementById('retry').onclick = () => location.replace(url)
document.getElementById('back').onclick = () => history.length > 2 ? history.go(-2) : location.replace(url)
addEventListener('online', () => location.replace(url))
