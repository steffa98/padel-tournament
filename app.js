import { arr, done, courtsInUse, defaultMinutes, suggestRounds, standings, makeRound, achievements } from './logic.js'

const $app = document.getElementById('app')
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)
const ls = {
  get: k => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k, v) => { try { localStorage.setItem(k, v) } catch {} },
}
const rid = (n, abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789') =>
  Array.from(crypto.getRandomValues(new Uint8Array(n)), x => abc[x % abc.length]).join('')

// ---- Sync backend: Firebase Realtime Database if configured, else localStorage (one device, syncs across tabs).
// Tournaments are deleted KEEP_DAYS after creation; must match the 30 days (2592000000 ms) in database.rules.json.
const KEEP_DAYS = 30, DAY = 86400000
let backend
if (window.FIREBASE_CONFIG) {
  const V = 'https://www.gstatic.com/firebasejs/10.12.2/'
  const { initializeApp } = await import(V + 'firebase-app.js')
  const { getDatabase, ref, onValue, update, get, query, orderByValue, endAt, limitToFirst } = await import(V + 'firebase-database.js')
  const db = getDatabase(initializeApp(window.FIREBASE_CONFIG))
  const now = { '.sv': 'timestamp' } // server time; the rules check it
  backend = {
    // Expired (or unreadable) tournaments show as "not found".
    watch: (code, cb) => onValue(ref(db, 't/' + code), s => cb(s.val()), () => cb(null)),
    update: (code, patch) => update(ref(db, 't/' + code), patch),
    // exp/<code> = creation time as a 13-digit string: rules can range-check query strings, not numbers.
    // It is the only list the rules let anyone read, and only its expired entries.
    create: (code, data) => update(ref(db), { ['t/' + code]: { ...data, created: now }, ['exp/' + code]: String(Date.now()) }),
  }
  // The free plan has no scheduled jobs, so every visit deletes up to 50 expired tournaments.
  // One extra day of margin for phones whose clock runs ahead of the server.
  get(query(ref(db, 'exp'), orderByValue(), endAt(String(Date.now() - (KEEP_DAYS + 1) * DAY)), limitToFirst(50)))
    .then(s => s.exists() && update(ref(db), Object.fromEntries(Object.keys(s.val()).flatMap(c => [['t/' + c, null], ['exp/' + c, null]]))))
    .catch(() => {})
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
    create(code, data) { this.update(code, { ...data, created: Date.now() }) },
  }
}

// ---- State
let code = null, t, unsub
const me = () => ls.get('me_' + code)
const isAdmin = () => ls.get('admin_' + code) === '1'
const save = patch => Promise.resolve(backend.update(code, patch)).catch(e => alert('Could not save: ' + e.message))
const players = () => Object.entries(t.players || {}).map(([id, p]) => ({ id, ...p })).sort((a, b) => (a.at || 0) - (b.at || 0))
const nameOf = id => esc(t.players?.[id]?.name ?? '?')
const minutes = () => defaultMinutes(t.points)
// Auto rounds follow who actually joined; before 4 have joined, use the planned player count.
const isFull = () => !!t.expected && players().length >= t.expected
const numRounds = () => t.numRounds || suggestRounds(players().length >= 4 ? players().length : t.expected || 4, t.courts)
const fmtDur = m => (m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m} min`)
const link = () => location.origin + location.pathname + '#' + code

// Rules form, before the tournament exists (#new) or when the organiser edits them in the lobby.
let draft = null
const newDraft = () => ({ name: 'Padel ' + new Date().toLocaleDateString(), mode: 'americano', courts: 2, points: 24, expected: 8, numRounds: null })

function route() {
  unsub?.()
  t = undefined
  code = location.hash.slice(1).toUpperCase() || null
  draft = code === 'NEW' ? newDraft() : null
  if (draft) code = null
  // A mistyped code (wrong length, '#', '.', …) is "not found"; Firebase would throw on some characters.
  if (code && !/^[A-Z0-9]{5}$/.test(code)) t = null
  render()
  if (code && t !== null) unsub = backend.watch(code, v => { t = v; renderSoon() })
}

// Clean player name, or null (after telling the user) when it is blank or already used.
function validName(raw, exceptId) {
  const name = String(raw ?? '').trim().replace(/\s+/g, ' ').slice(0, 24)
  if (!name) return null
  if (players().some(p => p.id !== exceptId && p.name.toLowerCase() === name.toLowerCase())) {
    alert(`"${name}" is already in the list. Add an initial to tell them apart.`)
    return null
  }
  return name
}

function render() {
  // Keep what the user is typing when a remote update re-renders the page.
  const f = document.activeElement
  const keep = f?.tagName === 'INPUT' && f.id ? { id: f.id, v: f.value } : null
  $app.innerHTML = !code ? (draft ? setup() : home())
    : t === undefined ? '<p class="muted">Loading…</p>'
    : t === null ? notFound()
    : t.status === 'lobby' ? (draft ? setup() : lobby())
    : t.status === 'playing' ? playing()
    : finished()
  if (keep) {
    const el = document.getElementById(keep.id)
    if (el) { el.value = keep.v; el.focus() }
  }
  // Wheels show their value by scroll position; unscored ones rest in the middle.
  for (const w of $app.querySelectorAll('.wheel')) w.scrollTop = Number(w.dataset.v) * w.children[1].offsetHeight
  drawQR()
}

// Don't re-render under a finger that is spinning a wheel (e.g. another court saving a score).
let holdUntil = 0, held
function renderSoon() {
  const wait = holdUntil - Date.now()
  if (wait <= 0) return render()
  clearTimeout(held)
  held = setTimeout(renderSoon, wait)
}

// ---- Screens
const home = () => `
  <h1>🎾 Padel Tournament</h1>
  <div class="card stack">
    <h2>Organise</h2>
    <a class="button primary" href="#new">Create a tournament</a>
  </div>
  <form class="card stack" data-submit="goto">
    <h2>Join</h2>
    <div class="row">
      <input name="code" placeholder="Tournament code" maxlength="5" autocapitalize="characters" autocomplete="off" required>
      <button>Join</button>
    </div>
  </form>
  <p class="muted">${modeInfo.americano}</p><p class="muted">${modeInfo.mexicano}</p>`

const modeInfo = {
  americano: 'Americano: partners rotate every round, everyone plays with everyone. Each player keeps the points their team scored.',
  mexicano: 'Mexicano: round 1 is random, then players of similar ranking play together (1st + 4th vs 2nd + 3rd).',
}

const notFound = () => `<h1>Tournament ${esc(code)} not found</h1>
  ${window.FIREBASE_CONFIG ? `<p>Check the code with the organiser. Tournaments are deleted ${KEEP_DAYS} days after they were created.</p>` : `<div class="banner">This app is not connected to a
  shared database yet, so a tournament only exists on the phone that created it. Add the Firebase config to
  index.html (see README) to let other phones join.</div>`}
  <a href="#">← Back</a>`

const top = title => `<div class="top"><a href="#" aria-label="Home">←</a><h1>${title}</h1></div>`

const stepper = (k, val, min, max) => `
  <div class="stepper">
    <button type="button" data-act="draftStep" data-k="${k}" data-d="-1" ${val <= min ? 'disabled' : ''} aria-label="Decrease ${k}">−</button>
    <b>${val}</b>
    <button type="button" data-act="draftStep" data-k="${k}" data-d="1" ${val >= max ? 'disabled' : ''} aria-label="Increase ${k}">+</button>
  </div>`

const draftRounds = () => draft.numRounds || suggestRounds(draft.expected, draft.courts)

// Step 1 (organiser): the rules. Nothing is shared until "Create".
function setup() {
  const d = draft, rounds = draftRounds(), used = courtsInUse(d, d.expected), mins = defaultMinutes(d.points)
  const sitting = d.expected - used * 4
  return `
  ${code ? `<div class="top"><button type="button" class="link" data-act="cancelDraft">← Back</button><h1>Edit rules</h1></div>`
    : top('New tournament')}
  <form class="card" data-submit="saveRules">
    <h2>Name</h2>
    <input id="d-name" name="name" data-draft="name" value="${esc(d.name)}" maxlength="40" required>
    <h2 style="margin-top:16px">Mode</h2>
    <div class="seg">
      ${['americano', 'mexicano'].map(m => `<button type="button" data-act="draftSet" data-k="mode" data-v="${m}" class="${d.mode === m ? 'on' : ''}">${m[0].toUpperCase() + m.slice(1)}</button>`).join('')}
    </div>
    <p class="muted">${modeInfo[d.mode]}</p>
    <div class="setting"><span>Max players</span>${stepper('expected', d.expected, code ? Math.max(4, players().length) : 4, 64)}</div>
    <div class="setting"><span>Courts</span>${stepper('courts', d.courts, 1, 20)}</div>
    <div class="setting"><span>Points per match</span>
      <select data-draft="points">${[16, 21, 24, 32].map(p => `<option ${p === d.points ? 'selected' : ''}>${p}</option>`).join('')}</select></div>
    <div class="setting"><span>Rounds</span>${stepper('numRounds', rounds, 1, 60)}</div>
    <div class="setting"><span>Minutes per round</span><b>≈ ${mins}</b></div>
    <div class="estimate">⏱ ≈ ${fmtDur(rounds * mins)}</div>
    <p class="muted" style="margin:4px 0 16px">${used} court${used > 1 ? 's' : ''} in use${used < d.courts ? ` (${d.expected} players fill only ${used})` : ''}
      · ${sitting ? `${sitting} sit${sitting > 1 ? '' : 's'} out each round · ` : ''}~${Math.round((rounds * used * 4) / d.expected)} matches per player.
      Minutes per round are estimated from the points (~30 s per point + 4 min to change courts).</p>
    <button class="primary">${code ? 'Save rules' : 'Create tournament & invite players'}</button>
  </form>`
}

// Step 2 (everyone): join with your name; the organiser starts when everyone is in.
function lobby() {
  const ps = players(), n = ps.length, admin = isAdmin(), mine = me()
  const joined = mine && t.players?.[mine]
  const used = courtsInUse(t, n), rounds = numRounds(), full = isFull()
  const joinCard = `
  <div class="card">
    <h2>Players (${n}${t.expected ? ` / ${t.expected}` : ''})</h2>
    ${joined ? `<p>You joined as <b>${nameOf(mine)}</b>.</p>`
      : full ? `<div class="banner">This tournament is full. Ask the organiser for a spot.</div>` : `
      <form class="row" data-submit="join" style="margin-bottom:12px">
        <input id="j-name" name="name" placeholder="Your name" maxlength="24" required autocomplete="given-name">
        <button>Join</button>
      </form>`}
    <ul class="players">
      ${ps.map(p => `<li><span>${esc(p.name)}${p.id === mine ? ' (you)' : ''}</span>
        ${admin ? `<span class="row">
          <button data-act="rename" data-id="${p.id}" aria-label="Rename ${esc(p.name)}">✎</button>
          <button data-act="remove" data-id="${p.id}" aria-label="Remove ${esc(p.name)}">✕</button></span>`
        : p.id === mine ? `<button data-act="remove" data-id="${p.id}" aria-label="Leave the tournament">✕</button>` : ''}</li>`).join('')}
    </ul>
    <p class="muted" style="margin:12px 0 0">Names are visible to anyone with this code and are deleted with the tournament
      ${KEEP_DAYS} days after it was created.</p>
    ${admin && full ? `<p class="muted" style="margin:12px 0 0">Full. To add more players, raise <b>Max players</b> in Edit rules.</p>`
      : admin ? `<form class="row" data-submit="add" style="margin-top:12px">
      <input id="a-name" name="name" placeholder="Add player without phone" maxlength="24" required>
      <button>Add</button></form>` : ''}
  </div>`
  const invite = `
  <div class="card">
    <h2>Invite players</h2>
    <div class="code">${esc(code)}</div>
    <div id="qr"></div>
    <button class="primary" data-act="share">Share link</button>
  </div>`
  return `
  ${top(esc(t.name))}
  ${admin || joined ? invite + joinCard : joinCard + invite}
  <div class="card">
    <h2>Rules</h2>
    <p style="margin:0"><b>${t.mode[0].toUpperCase() + t.mode.slice(1)}</b> · ${t.points} points per match · ${t.courts} court${t.courts > 1 ? 's' : ''} · ${rounds} rounds</p>
    <div class="estimate">⏱ ≈ ${fmtDur(rounds * minutes())}</div>
    ${n >= 4 && used < t.courts ? `<p class="muted" style="margin:4px 0 0">${n} players fill only ${used} court${used > 1 ? 's' : ''}.</p>` : ''}
    ${admin ? `<button data-act="editRules" style="margin-top:12px">Edit rules</button>` : ''}
  </div>
  ${admin ? `<button class="primary" data-act="start" ${n < 4 ? 'disabled' : ''}>${n < 4 ? 'Need at least 4 players' : 'Start tournament'}</button>`
    : `<p class="muted">Waiting for the organiser to start…</p>`}
  ${adminFooter()}`
}

function matchCard(r, m, i, mine) {
  const a = arr(m.a), b = arr(m.b), isMe = [...a, ...b].includes(mine), set = done(m)
  const names = ids => ids.map(nameOf).join(' & ')
  const nums = Array.from({ length: t.points + 1 }, (_, n) => `<div data-n="${n}">${n}</div>`).join('')
  const wheel = (side, v, label) => `<div class="wheel-wrap"><div class="wheel ${set ? '' : 'unset'}" tabindex="0"
    role="spinbutton" aria-label="Score ${esc(label)}" aria-valuemin="0" aria-valuemax="${t.points}" ${set ? `aria-valuenow="${v}"` : ''}
    data-wheel="${r}-${i}-${side}" data-v="${set ? v : Math.floor(t.points / 2)}"><div></div>${nums}<div></div></div></div>`
  return `<div class="match ${isMe ? 'me' : ''}">
    <div class="court muted">Court ${i + 1}${set ? '' : ' · <b>scroll or tap a number</b>'}</div>
    <span class="names-a">${names(a)}</span>${wheel('a', m.sa, names(a))}<span class="dash">–</span>${wheel('b', m.sb, names(b))}<span>${names(b)}</span>
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
  const missing = arr(cur.matches).filter(m => !done(m)).length
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
    <button class="primary" data-act="next" ${missing ? 'disabled' : ''}>${last ? 'Finish tournament' : `Next round →`}</button>
    ${missing ? `<p class="muted" style="text-align:center;margin:0">Enter ${missing} more score${missing > 1 ? 's' : ''} to continue</p>` : ''}
    <button class="danger" data-act="end">End tournament now</button>
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
  const awards = achievements(t, code)
  return `
  ${top('🏆 ' + esc(t.name))}
  <p class="muted" style="margin-top:0">Finished after ${played} of ${t.numRounds} rounds${played < t.numRounds ? ' (ended early)' : ''}.</p>
  ${!played ? '<div class="card"><p style="margin:0">No matches were scored, so there is no winner.</p></div>' : `
  <div class="card">
    ${s.slice(0, 3).map((p, i) => `<div class="estimate">${['🥇', '🥈', '🥉'][i]} ${esc(p.name)} <span class="muted">· ${p.pts} pts</span></div>`).join('')}
  </div>
  <div class="card wrapped">
    <h2>Tournament wrapped</h2>
    ${awards.map(a => `<div class="award"><span class="icon">${a.icon}</span><div><b>${esc(a.title)}</b><br>${esc(a.text)}</div></div>`).join('')}
  </div>
  <button class="primary" data-act="shareImage" style="margin-bottom:12px">📸 Share results picture</button>`}
  <div class="card"><h2>Final standings</h2>${standingsTable()}</div>
  <a class="button primary" href="#new">New tournament</a>`
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
  draftSet({ k, v }) {
    draft[k] = v
    render()
  },
  draftStep({ k, d }) {
    draft[k] = (k === 'numRounds' ? draftRounds() : draft[k]) + Number(d)
    render()
  },
  editRules() {
    const { name, mode, courts, points, numRounds = null, expected = players().length } = t
    draft = { name, mode, courts, points, numRounds, expected: Math.max(4, expected) }
    render()
  },
  cancelDraft() {
    draft = null
    render()
  },
  saveRules(fd) {
    const { mode, courts, points, expected, numRounds } = draft
    const rules = { name: String(fd.get('name')).trim() || 'Padel tournament', mode, courts, points, expected, numRounds }
    draft = null
    if (code) return save(rules)
    code = rid(5)
    ls.set('admin_' + code, '1')
    Promise.resolve(backend.create(code, { ...rules, status: 'lobby' })).catch(e => alert('Could not save: ' + e.message))
    location.hash = code
  },
  goto: fd => (location.hash = String(fd.get('code')).replace(/\s/g, '').toUpperCase()),
  // ponytail: cap is client-side only (Realtime Database rules can't count players); two phones taking the
  // last spot at the same instant can go one over. The organiser can remove the extra player.
  join(fd) {
    if (isFull()) return alert('Sorry, this tournament is full.')
    const name = validName(fd.get('name'))
    if (!name) return
    const id = rid(8)
    ls.set('me_' + code, id)
    save({ ['players/' + id]: { name, at: Date.now() } })
  },
  add(fd) {
    const name = !isFull() && validName(fd.get('name'))
    if (name) save({ ['players/' + rid(8)]: { name, at: Date.now() } })
  },
  remove({ id }) {
    if (!t.players?.[id]) return // already removed from another phone
    if (confirm(id === me() ? 'Leave the tournament?' : `Remove ${t.players[id].name}?`)) save({ ['players/' + id]: null })
  },
  rename({ id }) {
    if (!t.players?.[id]) return
    const input = prompt('New name', t.players[id].name)
    const name = input != null && validName(input, id)
    if (name) save({ [`players/${id}/name`]: name })
  },
  share() {
    const url = link()
    if (navigator.share) navigator.share({ title: t.name, text: `Join ${t.name}`, url }).catch(() => {})
    else navigator.clipboard.writeText(url).then(() => alert('Link copied'), () => prompt('Copy this link', url))
  },
  start() {
    if (players().length < 4) return // players left on another phone since the button was drawn
    const r = makeRound(t)
    save({ numRounds: numRounds(), status: 'playing', 'rounds/0': r })
  },
  next() {
    const rounds = arr(t.rounds)
    if (arr(rounds.at(-1).matches).some(m => !done(m))) return // every match needs a result first
    if (rounds.length >= t.numRounds) return save({ status: 'done' })
    save({ ['rounds/' + rounds.length]: makeRound(t) })
  },
  end() {
    if (confirm('End the tournament now? Current standings become final.')) save({ status: 'done' })
  },
  shareImage() {
    // Built synchronously so navigator.share still counts as a direct response to the tap (Safari).
    const bin = atob(wrappedImage().toDataURL('image/png').split(',')[1])
    const file = new File([Uint8Array.from(bin, c => c.charCodeAt(0))], 'padel-results.png', { type: 'image/png' })
    if (navigator.canShare?.({ files: [file] })) return navigator.share({ files: [file], title: t.name }).catch(() => {})
    const a = document.createElement('a')
    a.href = URL.createObjectURL(file)
    a.download = file.name
    a.click()
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
// Rules form: keep typed/selected values in the draft so stepper re-renders don't lose them.
$app.addEventListener('input', e => {
  const k = e.target.dataset.draft
  if (!k || !draft) return
  draft[k] = k === 'points' ? Number(e.target.value) : e.target.value
  if (k === 'points') render()
})

// ---- Score wheels. Fixed total: setting one side fills the other (e.g. to 24: 15 → 9).
function setScore(key, v) {
  const [r, i, side] = key.split('-')
  const m = arr(arr(t.rounds)[r]?.matches)[i]
  if (!m) return
  const sa = side === 'a' ? v : t.points - v
  holdUntil = 0
  if (done(m) && m.sa === sa) return render() // snap back to the stored value
  save({ [`rounds/${r}/matches/${i}/sa`]: sa, [`rounds/${r}/matches/${i}/sb`]: t.points - sa })
}
// Only user gestures count: setting scrollTop in render() also fires scroll events.
for (const ev of ['pointerdown', 'touchstart', 'wheel'])
  $app.addEventListener(ev, e => {
    const w = e.target.closest?.('.wheel')
    if (w) (w._touched = true), (holdUntil = Date.now() + 1500)
  }, { capture: true, passive: true })
$app.addEventListener('scroll', e => {
  const w = e.target
  if (!w.classList?.contains('wheel') || !w._touched) return
  holdUntil = Date.now() + 1500
  clearTimeout(w._timer)
  w._timer = setTimeout(() => setScore(w.dataset.wheel, Math.round(w.scrollTop / w.children[1].offsetHeight)), 180)
}, true)
$app.addEventListener('click', e => {
  const n = e.target.closest('.wheel [data-n]')
  if (n) setScore(n.parentElement.dataset.wheel, Number(n.dataset.n))
})
$app.addEventListener('keydown', e => {
  const w = e.target.closest?.('.wheel')
  const d = { ArrowUp: -1, ArrowDown: 1 }[e.key]
  if (!w || !d) return
  e.preventDefault()
  setScore(w.dataset.wheel, Math.max(0, Math.min(t.points, Number(w.dataset.v) + d)))
  requestAnimationFrame(() => document.querySelector(`[data-wheel="${w.dataset.wheel}"]`)?.focus())
})

// ---- Shareable "wrapped" picture (1080x1920, story format), drawn on a canvas: no dependencies.
function wrappedImage() {
  const W = 1080, H = 1920, c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d')
  const font = (size, weight = 700) => `${weight} ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`
  const bg = g.createLinearGradient(0, 0, W, H)
  bg.addColorStop(0, '#0a7d5a')
  bg.addColorStop(0.55, '#14386b')
  bg.addColorStop(1, '#5b1a6e')
  g.fillStyle = bg
  g.fillRect(0, 0, W, H)
  for (const [x, y, rad, col] of [[930, 230, 280, '#c6ff3d'], [90, 1450, 340, '#ff5fa2'], [1000, 1150, 160, '#38d9ff']]) {
    g.globalAlpha = 0.16
    g.fillStyle = col
    g.beginPath()
    g.arc(x, y, rad, 0, 7)
    g.fill()
  }
  g.globalAlpha = 1
  // Single line, shrunk until it fits.
  const line = (str, x, y, size, { weight = 700, color = '#fff', align = 'left', max = W - 160 } = {}) => {
    g.font = font(size, weight)
    while (g.measureText(str).width > max && size > 18) g.font = font(--size, weight)
    g.fillStyle = color
    g.textAlign = align
    g.fillText(str, x, y)
  }
  // Word-wrapped, at most `lines` lines.
  const wrap = (str, x, y, size, max, lines) => {
    g.font = font(size, 500)
    g.fillStyle = '#fff'
    g.textAlign = 'left'
    let cur = '', n = 0
    for (const word of str.split(' ')) {
      if (cur && g.measureText(cur + ' ' + word).width > max) {
        if (++n === lines) return g.fillText(cur + '…', x, y)
        g.fillText(cur, x, y)
        y += size * 1.25
        cur = word
      } else cur = cur ? cur + ' ' + word : word
    }
    g.fillText(cur, x, y)
  }
  const card = (y, h) => {
    g.fillStyle = 'rgba(255,255,255,0.12)'
    g.beginPath()
    g.roundRect(80, y, W - 160, h, 36)
    g.fill()
  }
  const s = standings(t), played = arr(t.rounds).filter(r => arr(r.matches).some(done)).length
  line('PADEL WRAPPED', 80, 170, 44, { weight: 800, color: '#c6ff3d' })
  line(t.name, 80, 270, 84, { weight: 800 })
  line(`${t.mode[0].toUpperCase() + t.mode.slice(1)} · ${s.length} players · ${played} round${played === 1 ? "" : "s"}`, 80, 335, 38, { weight: 500, color: 'rgba(255,255,255,.8)' })
  card(400, 330)
  s.slice(0, 3).forEach((p, i) => {
    const y = 490 + i * 95
    line(['🥇', '🥈', '🥉'][i] + ' ' + p.name, 120, y, 58, { max: 680 })
    line(p.pts + ' pts', W - 120, y, 46, { weight: 600, align: 'right', color: '#c6ff3d', max: 200 })
  })
  achievements(t, code).forEach((a, i) => {
    const y = 780 + i * 245
    card(y, 220)
    line(a.icon, 120, y + 130, 80, { max: 120 })
    line(a.title, 250, y + 80, 44, { weight: 800, color: '#c6ff3d', max: 690 })
    wrap(a.text, 250, y + 140, 36, 690, 2)
  })
  line('Made with Padel Tournament', W / 2, 1860, 30, { weight: 500, align: 'center', color: 'rgba(255,255,255,.7)' })
  return c
}

addEventListener('hashchange', route)
route()
