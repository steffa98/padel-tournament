// Edge-case sweep: node edge.test.mjs
import assert from 'node:assert/strict'
import { makeRound, standings, suggestRounds, achievements, courtsInUse, defaultMinutes } from './logic.js'

const players = n => Object.fromEntries(Array.from({ length: n }, (_, i) => ['p' + i, { name: 'P' + i }]))
const rand = n => Math.floor(Math.random() * (n + 1))

// Every player count 4..40, courts 1..10, both modes, odd/even points: rounds are always valid.
for (const mode of ['americano', 'mexicano'])
  for (let n = 4; n <= 40; n++)
    for (let courts = 1; courts <= 10; courts++) {
      const points = [16, 21, 24, 32][n % 4]
      const t = { mode, courts, points, players: players(n), rounds: [] }
      const used = courtsInUse(t, n)
      const rounds = Math.min(suggestRounds(n, courts), 25)
      const sat = Object.fromEntries(Object.keys(t.players).map(id => [id, 0]))
      for (let r = 0; r < rounds; r++) {
        const round = makeRound(t)
        const ids = round.matches.flatMap(m => [...m.a, ...m.b])
        const tag = `${mode} n=${n} courts=${courts} round=${r}`
        assert.equal(round.matches.length, used, tag + ' courts used')
        assert.equal(round.sit.length, n - used * 4, tag + ' sit-outs')
        assert.equal(new Set([...ids, ...round.sit]).size, n, tag + ' everyone exactly once')
        assert.ok(round.matches.every(m => m.a.length === 2 && m.b.length === 2), tag + ' 2 v 2')
        for (const id of round.sit) sat[id]++
        // sit-outs are spread evenly at all times
        const s = Object.values(sat)
        assert.ok(Math.max(...s) - Math.min(...s) <= 1, tag + ' fair sit-outs')
        for (const m of round.matches) {
          m.sa = rand(points)
          m.sb = points - m.sa
        }
        t.rounds.push(round)
      }
      // standings and achievements never crash and stay consistent
      const st = standings(t)
      assert.equal(st.length, n)
      const total = st.reduce((x, p) => x + p.pts, 0)
      assert.equal(total, rounds * used * points * 2, `${mode} n=${n} points conserved`)
      const aw = achievements(t, 'SEED1')
      assert.ok(aw.length >= 1 && aw.length <= 4 && aw.every(a => a.icon && a.title && a.text && !a.text.includes('undefined')))
    }

// Fewer than 4 players: nothing to schedule, no crash.
assert.equal(suggestRounds(3, 2), 0)
assert.equal(courtsInUse({ courts: 2 }, 3), 0)

// All draws: no "Demolition", nail-biter shows the draw.
{
  const t = { players: players(4), rounds: [{ matches: [{ a: ['p0', 'p1'], b: ['p2', 'p3'], sa: 12, sb: 12 }] }] }
  const titles = achievements(t, 'x', 99).map(a => a.title)
  assert.ok(!titles.includes('Demolition') && titles.includes('Nail-biter') && !titles.includes('Win collector'))
}

// 0–24 whitewash and the edge values of the score range.
{
  const t = { players: players(4), rounds: [{ matches: [{ a: ['p0', 'p1'], b: ['p2', 'p3'], sa: 0, sb: 24 }] }] }
  const s = standings(t)
  assert.deepEqual(s.map(p => p.pts), [24, 24, 0, 0])
  assert.ok(achievements(t, 'x', 99).some(a => a.text === 'P2 & P3 beat P0 & P1 24–0'))
}

// Tournament ended right after starting: nothing scored, no awards, standings all zero.
{
  const t = { mode: 'americano', courts: 2, players: players(8), rounds: [] }
  t.rounds.push(makeRound(t))
  assert.deepEqual(achievements(t, 'x'), [])
  assert.ok(standings(t).every(p => p.pts === 0 && p.played === 0))
}

// A player removed from the list still in old rounds (shouldn't happen, but must not crash).
{
  const t = { players: players(3), rounds: [{ matches: [{ a: ['p0', 'p1'], b: ['p2', 'p3'], sa: 20, sb: 4 }] }] }
  assert.equal(standings(t).length, 3)
  assert.ok(achievements(t, 'x', 99).every(a => !a.text.includes('undefined')))
}

// Firebase drops empty arrays and may return arrays as {0:…,1:…} objects.
{
  const t = { mode: 'mexicano', courts: 1, players: players(4), rounds: { 0: { matches: { 0: { a: { 0: 'p0', 1: 'p1' }, b: { 0: 'p2', 1: 'p3' }, sa: 15, sb: 9 } } } } }
  const r = makeRound(t)
  assert.equal(r.matches.length, 1)
  assert.deepEqual(r.sit, [])
  assert.equal(standings(t)[0].pts, 15)
}

// Time estimate is sane for every points option.
assert.deepEqual([16, 21, 24, 32].map(defaultMinutes), [12, 15, 16, 20])

// Big club night is still fast: 64 players, 16 courts, 20 rounds.
{
  const t0 = Date.now()
  const t = { mode: 'americano', courts: 16, players: players(64), rounds: [] }
  for (let r = 0; r < 20; r++) t.rounds.push(makeRound(t))
  assert.ok(Date.now() - t0 < 3000, 'pairing 64 players is fast')
}

console.log('edge cases ok')
