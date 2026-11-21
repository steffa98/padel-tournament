// Pure tournament logic: pairing, standings, estimates. No DOM, so it can be tested with node.

export const arr = v => (Array.isArray(v) ? v : Object.values(v || {})) // Firebase may return arrays as objects
export const done = m => Number.isFinite(m.sa) && Number.isFinite(m.sb)
export const courtsInUse = (t, n) => Math.min(t.courts, Math.floor(n / 4))
// ~30s per point plus changeover
export const defaultMinutes = points => Math.round(points * 0.5 + 4)
// Enough rounds for each player to play ~ (n-1) matches, i.e. a full Americano rotation.
export const suggestRounds = (n, courts) => {
  const c = Math.min(courts, Math.floor(n / 4))
  return c ? Math.ceil((n * (n - 1)) / (4 * c)) : 0
}

const shuffle = a => {
  a = [...a]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export function standings(t) {
  const s = {}
  for (const [id, p] of Object.entries(t.players || {})) s[id] = { id, name: p.name, pts: 0, won: 0, played: 0 }
  for (const r of arr(t.rounds))
    for (const m of arr(r.matches)) {
      if (!done(m)) continue
      for (const [team, my, their] of [[m.a, m.sa, m.sb], [m.b, m.sb, m.sa]])
        for (const id of arr(team)) {
          const p = s[id]
          if (!p) continue
          p.pts += my
          p.played++
          if (my > their) p.won++
        }
    }
  return Object.values(s).sort((x, y) => y.pts - x.pts || y.won - x.won || x.name.localeCompare(y.name))
}

// Builds the next round from the history in t. Americano: minimise repeated partners/opponents.
// Mexicano: after round 1, group by current ranking, 1st+4th vs 2nd+3rd.
export function makeRound(t) {
  const ids = Object.keys(t.players || {})
  const past = arr(t.rounds)
  const playing = courtsInUse(t, ids.length) * 4
  const key = (x, y) => (x < y ? x + '|' + y : y + '|' + x)
  const sat = {}, partner = {}, opp = {}
  const inc = (o, k) => (o[k] = (o[k] || 0) + 1)
  for (const r of past) {
    for (const id of arr(r.sit)) inc(sat, id)
    for (const m of arr(r.matches)) {
      const a = arr(m.a), b = arr(m.b)
      inc(partner, key(...a))
      inc(partner, key(...b))
      for (const x of a) for (const y of b) inc(opp, key(x, y))
    }
  }

  // Whoever sat out least sits out now; shuffle first so ties are random (sort is stable).
  const order = shuffle(ids).sort((x, y) => (sat[x] || 0) - (sat[y] || 0))
  const sit = order.slice(0, ids.length - playing)
  const active = order.slice(sit.length)

  if (t.mode === 'mexicano' && past.length) {
    const rank = standings(t).map(p => p.id)
    active.sort((x, y) => rank.indexOf(x) - rank.indexOf(y))
    const matches = []
    for (let i = 0; i < active.length; i += 4) {
      const [p1, p2, p3, p4] = active.slice(i, i + 4)
      matches.push({ a: [p1, p4], b: [p2, p3] })
    }
    return { matches, sit }
  }

  const cost = (a, b) =>
    10 * ((partner[key(...a)] || 0) + (partner[key(...b)] || 0)) +
    a.reduce((n, x) => n + b.reduce((n2, y) => n2 + (opp[key(x, y)] || 0), 0), 0)
  let best, bestCost = Infinity
  // ponytail: random search, not an optimal schedule table; good enough for club-size groups (<= ~40 players).
  for (let k = 0; k < 400 && bestCost > 0; k++) {
    const s = shuffle(active), ms = []
    let total = 0
    for (let i = 0; i < s.length; i += 4) {
      const [p, q, r, u] = s.slice(i, i + 4)
      let bm, bc = Infinity
      for (const [a, b] of [[[p, q], [r, u]], [[p, r], [q, u]], [[p, u], [q, r]]]) {
        const c = cost(a, b)
        if (c < bc) (bc = c), (bm = { a, b })
      }
      total += bc
      ms.push(bm)
    }
    if (total < bestCost) (bestCost = total), (best = ms)
  }
  return { matches: best, sit }
}
