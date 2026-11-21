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

// Seeded RNG (mulberry32) so every phone picks the same "random" achievements for a tournament.
const rng = seed => {
  let a = [...String(seed)].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261)
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// "Wrapped"-style fun facts: computes every award that applies, then picks `count` at random (seeded).
export function achievements(t, seed = '', count = 4) {
  const name = id => t.players?.[id]?.name ?? '?'
  const team = ids => arr(ids).map(name).join(' & ')
  const rounds = arr(t.rounds)
  const ms = rounds.flatMap(r => arr(r.matches)).filter(done)
  if (!ms.length) return []
  const best = (list, score) => list.reduce((b, x) => (score(x) > score(b) ? x : b))
  const key = ids => [...ids].sort().join('|')
  const s = standings(t)
  const p = Object.fromEntries(s.map(x => [x.id, { ...x, conceded: 0, streak: 0, bestStreak: 0, close: 0, sat: 0, first: null }]))
  const partners = {}, rivals = {}
  for (const r of rounds) {
    if (arr(r.matches).some(done)) for (const id of arr(r.sit)) if (p[id]) p[id].sat++ // skip a round ended unplayed
    for (const m of arr(r.matches).filter(done)) {
      for (const [mine, other, my, their] of [[m.a, m.b, m.sa, m.sb], [m.b, m.a, m.sb, m.sa]]) {
        const k = key(arr(mine))
        partners[k] ??= { ids: arr(mine), pts: 0, n: 0 }
        partners[k].pts += my
        partners[k].n++
        for (const id of arr(mine)) {
          const x = p[id]
          if (!x) continue
          x.conceded += their
          x.first ??= my > their
          x.streak = my > their ? x.streak + 1 : 0
          x.bestStreak = Math.max(x.bestStreak, x.streak)
          if (my < their && their - my <= 2) x.close++
          for (const o of arr(other)) if (id < o) (rivals[id + '|' + o] ??= { ids: [id, o], n: 0 }).n++
        }
      }
    }
  }
  const ps = Object.values(p).filter(x => x.played)
  const margin = m => Math.abs(m.sa - m.sb)
  const out = []
  const big = best(ms, margin)
  if (margin(big)) {
    const [w, l] = big.sa > big.sb ? [big.a, big.b] : [big.b, big.a]
    out.push({ icon: '💥', title: 'Demolition', text: `${team(w)} beat ${team(l)} ${Math.max(big.sa, big.sb)}–${Math.min(big.sa, big.sb)}` })
  }
  const tight = best(ms, m => -margin(m))
  if (margin(tight) <= 2)
    out.push({ icon: '😅', title: 'Nail-biter', text: `${team(tight.a)} vs ${team(tight.b)} ended ${tight.sa}–${tight.sb}` })
  const fire = best(ps, x => x.bestStreak)
  if (fire.bestStreak >= 2) out.push({ icon: '🔥', title: 'On fire', text: `${fire.name} won ${fire.bestStreak} matches in a row` })
  const dream = best(Object.values(partners), x => x.pts / x.n + x.n / 100)
  out.push({ icon: '🤝', title: 'Dream team', text: `${team(dream.ids)} scored ${Math.round(dream.pts / dream.n)} points per match together` })
  const wall = best(ps, x => -x.conceded / x.played)
  out.push({ icon: '🧱', title: 'The Wall', text: `${wall.name} conceded only ${(wall.conceded / wall.played).toFixed(1)} points per match` })
  const wins = best(ps, x => x.won)
  if (wins.won) out.push({ icon: '🎯', title: 'Win collector', text: `${wins.name} won ${wins.won} of ${wins.played} matches` })
  const bench = best(Object.values(p), x => x.sat)
  if (bench.sat) out.push({ icon: '🪑', title: 'Bench warmer', text: `${bench.name} sat out ${bench.sat} time${bench.sat > 1 ? 's' : ''} and still smiled` })
  const rival = Object.values(rivals).length && best(Object.values(rivals), x => x.n)
  if (rival?.n >= 2) out.push({ icon: '⚔️', title: 'Rivals', text: `${team(rival.ids).replace(' & ', ' and ')} faced each other ${rival.n} times` })
  const unlucky = best(ps, x => x.close)
  if (unlucky.close) out.push({ icon: '💔', title: 'So close', text: `${unlucky.name} lost ${unlucky.close} match${unlucky.close > 1 ? 'es' : ''} by 2 points or less` })
  const comeback = s.slice(0, 3).find(x => p[x.id].first === false)
  if (comeback) out.push({ icon: '🚀', title: 'Comeback', text: `${comeback.name} lost the first match and still finished #${s.indexOf(comeback) + 1}` })
  if (s.length > 3) out.push({ icon: '🌱', title: 'Best is yet to come', text: `${s.at(-1).name}, next time is yours` })

  const rand = rng(seed)
  return out
    .map(a => [rand(), a])
    .sort((x, y) => x[0] - y[0])
    .slice(0, count)
    .map(x => x[1])
}
