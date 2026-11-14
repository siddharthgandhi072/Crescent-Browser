const q = new URLSearchParams(location.search)
const until = Number(q.get('until')) || 0
try { document.getElementById('site').textContent = new URL(q.get('url')).host } catch {}
const tick = () => {
  const ms = Math.max(0, until - Date.now())
  const m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000)
  document.getElementById('left').textContent = ms ? `${m}:${String(s).padStart(2, '0')} left` : 'Session over'
  if (!ms && until) location.replace(q.get('url'))
}
tick(); setInterval(tick, 1000)
document.getElementById('back').onclick = () => history.length > 2 ? history.go(-2) : history.back()
