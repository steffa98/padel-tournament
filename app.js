import { arr, done, courtsInUse, defaultMinutes, suggestRounds, standings, makeRound } from './logic.js'

const $app = document.getElementById('app')
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)
const ls = {
  get: k => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k, v) => { try { localStorage.setItem(k, v) } catch {} },
}
const rid = (n, abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789') =>
  Array.from(crypto.getRandomValues(new Uint8Array(n)), x => abc[x % abc.length]).join('')

// ---- Sync backend: Firebase Realtime Database if configured, else localStorage (one device, syncs across tabs).
let backend
if (window.FIREBASE_CONFIG) {
  const V = 'https://www.gstatic.com/firebasejs/10.12.2/'
  const { initializeApp } = await import(V + 'firebase-app.js')
  const { getDatabase, ref, onValue, update } = await import(V + 'firebase-database.js')
  const db = getDatabase(initializeApp(window.FIREBASE_CONFIG))
  backend = {
    watch: (code, cb) => onValue(ref(db, 't/' + code), s => cb(s.val())),
    update: (code, patch) => update(ref(db, 't/' + code), patch),
  }
} else {
  const read = code => JSON.parse(ls.get('t_' + code) || 'null')
  let listener
  backend = {
    watch(code, cb) {
      listener = () => cb(read(code))
      addEventListener('storage', listener)
      listener()
      return () => removeEventListener('storage', listener)
    },
    update(code, patch) { // same multi-path semantics as Firebase update()
      const t = read(code) || {}
      for (const [path, v] of Object.entries(patch)) {
        const keys = path.split('/'), last = keys.pop()
        let o = t
        for (const k of keys) o = o[k] ??= {}
        if (v == null) delete o[last]
        else o[last] = structuredClone(v)
      }
      ls.set('t_' + code, JSON.stringify(t))
      listener?.()
    },
  }
}

// ---- State
let code = null, t, unsub
const me = () => ls.get('me_' + code)
const isAdmin = () => ls.get('admin_' + code) === '1'
const save = patch => Promise.resolve(backend.update(code, patch)).catch(e => alert('Could not save: ' + e.message))
const players = () => Object.entries(t.players || {}).map(([id, p]) => ({ id, ...p }))
const nameOf = id => esc(t.players?.[id]?.name ?? '?')
const minutes = () => t.minutes || defaultMinutes(t.points)
const numRounds = () => t.numRounds || suggestRounds(players().length, t.courts)
const fmtDur = m => (m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m} min`)
const link = () => location.origin + location.pathname + '#' + code

function route() {
  unsub?.()
  t = undefined
  code = location.hash.slice(1).toUpperCase() || null
  render()
  if (code) unsub = backend.watch(code, v => { t = v; render() })
}

function render() {
  // Keep what the user is typing when a remote update re-renders the page.
  const f = document.activeElement
  const keep = f?.tagName === 'INPUT' && f.id ? { id: f.id, v: f.value } : null
  $app.innerHTML = !code ? home()
    : t === undefined ? '<p class="muted">Loading…</p>'
    : t === null ? `<h1>Tournament ${esc(code)} not found</h1><a href="#">← Back</a>`
    : t.status === 'lobby' ? lobby()
    : t.status === 'playing' ? playing()
    : finished()
  if (keep) {
    const el = document.getElementById(keep.id)
    if (el) { el.value = keep.v; el.focus() }
  }
  drawQR()
}

// ---- Screens
const home = () => `
  <h1>🎾 Padel Tournament</h1>
  <div class="card stack">
    <h2>Organise</h2>
    <button class="primary" data-act="create">New tournament</button>
  </div>
  <form class="card stack" data-submit="goto">
    <h2>Join</h2>
    <div class="row">
      <input name="code" placeholder="Tournament code" maxlength="5" autocapitalize="characters" autocomplete="off" required>
      <button>Join</button>
    </div>
  </form>
  <p class="muted">Americano: partners rotate every round, everyone plays with everyone.
  Mexicano: after round 1, players of similar ranking play together (1st + 4th vs 2nd + 3rd).
  Each match is played to a fixed number of points; every player keeps the points their team scored.</p>`

const top = title => `<div class="top"><a href="#" aria-label="Home">←</a><h1>${title}</h1></div>`

const stepper = (k, val, min, max) => `
  <div class="stepper">
    <button data-act="step" data-k="${k}" data-d="-1" ${!isAdmin() || val <= min ? 'disabled' : ''} aria-label="Decrease">−</button>
    <b>${val}</b>
    <button data-act="step" data-k="${k}" data-d="1" ${!isAdmin() || val >= max ? 'disabled' : ''} aria-label="Increase">+</button>
  </div>`

function lobby() {
  const ps = players(), n = ps.length, admin = isAdmin(), dis = admin ? '' : 'disabled'
  const used = courtsInUse(t, n), sitting = n - used * 4, total = numRounds() * minutes()
  const perPlayer = n ? Math.round((numRounds() * used * 4) / n) : 0
  const mine = me()
  return `
  ${top(esc(t.name))}
  <div class="card">
    <h2>Invite players</h2>
    <div class="code">${esc(code)}</div>
    <div id="qr"></div>
    <button class="primary" data-act="share">Share link</button>
  </div>

  <div class="card">
    <h2>Players (${n})</h2>
    ${mine && t.players?.[mine] ? `<p>You joined as <b>${nameOf(mine)}</b>.</p>` : `
      <form class="row" data-submit="join" style="margin-bottom:12px">
        <input name="name" placeholder="Your name" maxlength="24" required autocomplete="given-name">
        <button>Join</button>
      </form>`}
    <ul class="players">
      ${ps.map(p => `<li><span>${esc(p.name)}${p.id === mine ? ' (you)' : ''}</span>
        ${admin || p.id === mine ? `<button data-act="remove" data-id="${p.id}" aria-label="Remove ${esc(p.name)}">✕</button>` : ''}</li>`).join('')}
    </ul>
    ${admin ? `<form class="row" data-submit="add" style="margin-top:12px">
      <input name="name" placeholder="Add player without phone" maxlength="24" required>
      <button>Add</button></form>` : ''}
  </div>

  <div class="card">
    <h2>Settings</h2>
    <div class="seg" style="margin-bottom:6px">
      ${['americano', 'mexicano'].map(m => `<button data-act="set" data-k="mode" data-v="${m}" class="${t.mode === m ? 'on' : ''}" ${dis}>${m[0].toUpperCase() + m.slice(1)}</button>`).join('')}
    </div>
    <div class="setting"><span>Courts</span>${stepper('courts', t.courts, 1, 20)}</div>
    <div class="setting"><span>Points per match</span>
      <select data-change="points" ${dis}>${[16, 21, 24, 32].map(p => `<option ${p === t.points ? 'selected' : ''}>${p}</option>`).join('')}</select></div>
    <div class="setting"><span>Rounds</span>${stepper('numRounds', numRounds(), 1, 60)}</div>
    <div class="setting"><span>Minutes per round</span>${stepper('minutes', minutes(), 5, 60)}</div>
    <div class="estimate">⏱ ≈ ${fmtDur(total)}</div>
    <p class="muted" style="margin:4px 0 0">${n < 4 ? 'Need at least 4 players.' :
      `${used} court${used > 1 ? 's' : ''} in use${used < t.courts ? ` (not enough players for ${t.courts})` : ''}
      · ${sitting ? `${sitting} sit${sitting > 1 ? '' : 's'} out each round · ` : ''}~${perPlayer} matches per player`}</p>
  </div>

  ${admin ? `<button class="primary" data-act="start" ${n < 4 ? 'disabled' : ''}>Start tournament</button>`
    : `<p class="muted">Waiting for the organiser to start…</p>`}
  ${adminFooter()}`
}

function matchCard(r, m, i, mine) {
  const a = arr(m.a), b = arr(m.b), isMe = [...a, ...b].includes(mine)
  const input = (side, v) => `<input id="s-${r}-${i}-${side}" data-score="${r}-${i}-${side}" type="number" inputmode="numeric"
    min="0" max="${t.points}" value="${v ?? ''}" aria-label="Score" ${t.status === 'done' ? 'disabled' : ''}>`
  return `<div class="match ${isMe ? 'me' : ''}">
    <div class="muted">Court ${i + 1}</div>
    <div class="team"><span>${a.map(nameOf).join(' & ')}</span>${input('a', m.sa)}</div>
    <div class="vs">vs</div>
    <div class="team"><span>${b.map(nameOf).join(' & ')}</span>${input('b', m.sb)}</div>
  </div>`
}

function standingsTable() {
  const mine = me()
  return `<table><tr><th>#</th><th>Player</th><th class="num">Pts</th><th class="num">W</th><th class="num">Played</th></tr>
    ${standings(t).map((p, i) => `<tr class="${p.id === mine ? 'me' : ''}"><td>${i + 1}</td><td>${esc(p.name)}</td>
      <td class="num"><b>${p.pts}</b></td><td class="num">${p.won}</td><td class="num">${p.played}</td></tr>`).join('')}
  </table>`
}

function playing() {
  const rounds = arr(t.rounds), r = rounds.length - 1, cur = rounds[r], mine = me()
  const left = (t.numRounds - r) * minutes()
  const ends = new Date(Date.now() + left * 60000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const myMatch = arr(cur.matches).findIndex(m => [...arr(m.a), ...arr(m.b)].includes(mine))
  const last = r + 1 >= t.numRounds
  return `
  ${top(esc(t.name))}
  <p class="muted" style="margin-top:0">Round <b>${r + 1}</b> of ${t.numRounds} · ≈ ${fmtDur(left)} left · ends ~${ends}</p>
  ${!mine ? '' : myMatch >= 0 ? `<div class="banner">You play on court ${myMatch + 1}</div>`
    : arr(cur.sit).includes(mine) ? `<div class="banner">You sit out this round</div>` : ''}
  <div class="card">
    <h2>Round ${r + 1} · ${t.mode} · to ${t.points}</h2>
    ${arr(cur.matches).map((m, i) => matchCard(r, m, i, mine)).join('')}
    ${arr(cur.sit).length ? `<p class="muted">Sitting out: ${arr(cur.sit).map(nameOf).join(', ')}</p>` : ''}
  </div>
  ${isAdmin() ? `<div class="stack" style="margin-bottom:12px">
    <button class="primary" data-act="next">${last ? 'Finish tournament' : `Next round →`}</button>
    ${last ? '' : `<button class="danger" data-act="end">End tournament now</button>`}
  </div>` : ''}
  <div class="card"><h2>Standings</h2>${standingsTable()}</div>
  ${r ? `<div class="card"><details><summary>Previous rounds (tap to edit scores)</summary>
    ${rounds.slice(0, -1).map((rd, ri) => `<h2 style="margin-top:12px">Round ${ri + 1}</h2>` +
      arr(rd.matches).map((m, i) => matchCard(ri, m, i, mine)).join('')).reverse().join('')}
  </details></div>` : ''}
  ${adminFooter()}`
}

function finished() {
  const s = standings(t), played = arr(t.rounds).filter(r => arr(r.matches).some(done)).length
  return `
  ${top('🏆 ' + esc(t.name))}
  <p class="muted" style="margin-top:0">Finished after ${played} of ${t.numRounds} rounds${played < t.numRounds ? ' (ended early)' : ''}.</p>
  <div class="card">
    ${s.slice(0, 3).map((p, i) => `<div class="estimate">${['🥇', '🥈', '🥉'][i]} ${esc(p.name)} <span class="muted">· ${p.pts} pts</span></div>`).join('')}
  </div>
  <div class="card"><h2>Final standings</h2>${standingsTable()}</div>
  <button class="primary" data-act="create">New tournament</button>`
}

const adminFooter = () => isAdmin() ? '' :
  `<p style="text-align:center;margin-top:24px"><button class="link" data-act="unlock">I'm the organiser</button></p>`

// ---- QR code (lazy loaded, only on the lobby screen)
let qrLib
function drawQR() {
  const el = document.getElementById('qr')
  if (!el) return
  if (!window.qrcode) {
    qrLib ??= new Promise((ok, fail) => {
      const s = document.createElement('script')
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js'
      s.onload = ok
      s.onerror = fail
      document.head.append(s)
    })
    return qrLib.then(drawQR, () => {}) // offline: no QR, code + share link still work
  }
  const q = qrcode(0, 'M')
  q.addData(link())
  q.make()
  el.innerHTML = q.createSvgTag(4, 8)
}

// ---- Actions
const actions = {
  create() {
    const c = rid(5)
    ls.set('admin_' + c, '1')
    code = c
    save({ name: 'Padel ' + new Date().toLocaleDateString(), mode: 'americano', points: 24, courts: 2, status: 'lobby', created: Date.now() })
    location.hash = c
  },
  goto: fd => (location.hash = String(fd.get('code')).trim().toUpperCase()),
  join(fd) {
    const id = rid(8)
    ls.set('me_' + code, id)
    save({ ['players/' + id]: { name: String(fd.get('name')).trim() } })
  },
  add: fd => save({ ['players/' + rid(8)]: { name: String(fd.get('name')).trim() } }),
  remove: ({ id }) => save({ ['players/' + id]: null }),
  set: ({ k, v }) => save({ [k]: v }),
  step({ k, d }) {
    const cur = { courts: t.courts, numRounds: numRounds(), minutes: minutes() }[k]
    save({ [k]: cur + Number(d) })
  },
  share() {
    const url = link()
    if (navigator.share) navigator.share({ title: t.name, text: `Join ${t.name}`, url }).catch(() => {})
    else navigator.clipboard.writeText(url).then(() => alert('Link copied'), () => prompt('Copy this link', url))
  },
  start() {
    const r = makeRound(t)
    save({ numRounds: numRounds(), minutes: minutes(), status: 'playing', 'rounds/0': r })
  },
  next() {
    const rounds = arr(t.rounds)
    if (arr(rounds.at(-1).matches).some(m => !done(m)) &&
      !confirm('Some scores are missing. Those matches will not count. Continue?')) return
    if (rounds.length >= t.numRounds) return save({ status: 'done' })
    save({ ['rounds/' + rounds.length]: makeRound(t) })
  },
  end() {
    if (confirm('End the tournament now? Current standings become final.')) save({ status: 'done' })
  },
  unlock() {
    if (confirm('Show organiser controls (settings, start, next round, end) on this device?')) {
      ls.set('admin_' + code, '1')
      render()
    }
  },
}

$app.addEventListener('click', e => {
  const b = e.target.closest('[data-act]')
  if (b && !b.disabled) actions[b.dataset.act](b.dataset)
})
$app.addEventListener('submit', e => {
  e.preventDefault()
  actions[e.target.dataset.submit](new FormData(e.target))
})
$app.addEventListener('change', e => {
  if (e.target.dataset.change === 'points') save({ points: Number(e.target.value), minutes: null })
})
// Save scores on every keystroke (not on blur): a save re-renders the page, and doing that while the
// user taps the next field would swallow the tap.
$app.addEventListener('input', e => {
  const el = e.target
  if (!el.dataset.score) return
  // Fixed total: entering one side fills the other (e.g. 24: 15 → 9).
  const [r, i, side] = el.dataset.score.split('-')
  const base = `rounds/${r}/matches/${i}/`
  const v = el.value === '' ? null : Math.max(0, Math.min(t.points, Math.round(Number(el.value))))
  const other = v == null ? null : t.points - v
  save(side === 'a' ? { [base + 'sa']: v, [base + 'sb']: other } : { [base + 'sb']: v, [base + 'sa']: other })
})

addEventListener('hashchange', route)
route()
