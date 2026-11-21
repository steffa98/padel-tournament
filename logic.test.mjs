// Self-check: node logic.test.mjs
import assert from 'node:assert/strict'
import { makeRound, standings, suggestRounds } from './logic.js'

const players = n => Object.fromEntries(Array.from({ length: n }, (_, i) => ['p' + i, { name: 'P' + i }]))
const play = (t, rounds, score = (m, i) => 24 - i) => {
  t.rounds = []
  for (let r = 0; r < rounds; r++) {
    const round = makeRound(t)
    round.matches.forEach((m, i) => ((m.sa = score(m, i)), (m.sb = 24 - m.sa)))
    t.rounds.push(round)
  }
  return t
}

// Americano 8 players / 2 courts / 7 rounds: everyone plays every round, partners rarely repeat.
{
  const t = play({ mode: 'americano', courts: 2, players: players(8) }, suggestRounds(8, 2))
  assert.equal(t.rounds.length, 7)
  const pairs = {}
  for (const r of t.rounds) {
    assert.equal(r.sit.length, 0)
    const seen = r.matches.flatMap(m => [...m.a, ...m.b])
    assert.equal(new Set(seen).size, 8, 'each player once per round')
    for (const m of r.matches) for (const p of [m.a, m.b]) pairs[p.sort().join()] = (pairs[p.sort().join()] || 0) + 1
  }
  assert.ok(Object.keys(pairs).length >= 24, 'at least 24 of 28 possible partnerships used') // perfect = 28
}

// 10 players / 3 courts -> 2 courts used, 2 sit out, sit-outs rotate evenly.
{
  const t = play({ mode: 'americano', courts: 3, players: players(10) }, 10)
  const sat = {}
  for (const r of t.rounds) {
    assert.equal(r.matches.length, 2)
    assert.equal(r.sit.length, 2)
    for (const id of r.sit) sat[id] = (sat[id] || 0) + 1
  }
  assert.deepEqual(Object.values(sat), Array(10).fill(2), 'everyone sits out exactly twice')
}

// Mexicano: round 2 pairs rank 1 + rank 4 vs rank 2 + rank 3.
{
  const t = { mode: 'mexicano', courts: 1, players: players(4) }
  t.rounds = [{ matches: [{ a: ['p0', 'p1'], b: ['p2', 'p3'], sa: 15, sb: 9 }] }]
  // ties broken by name: p0,p1 (15) then p2,p3 (9)
  const { matches } = makeRound(t)
  assert.deepEqual(matches, [{ a: ['p0', 'p3'], b: ['p1', 'p2'] }])
  const s = standings(t)
  assert.deepEqual(s.map(p => p.pts), [15, 15, 9, 9])
  assert.equal(s[0].won, 1)
}

// Unscored matches don't count.
{
  const t = { players: players(4), rounds: [{ matches: [{ a: ['p0', 'p1'], b: ['p2', 'p3'] }] }] }
  assert.ok(standings(t).every(p => p.played === 0))
}

console.log('logic ok')
