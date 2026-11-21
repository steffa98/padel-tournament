// Database rules test against the Firebase emulator (needs Java 11+), with 30 days shortened to 3 s:
//   npm i --no-save firebase@10.12.2 firebase-tools
//   npx firebase emulators:exec --only database --project demo-test "node rules.test.mjs"
import { readFileSync } from 'node:fs'
import { initializeApp } from 'firebase/app'
import { getDatabase, connectDatabaseEmulator, ref, get, update, query, orderByValue, endAt, limitToFirst } from 'firebase/database'
const db = getDatabase(initializeApp({ projectId: 'demo-test', databaseURL: 'http://127.0.0.1:9000?ns=demo-test-default-rtdb' }))
connectDatabaseEmulator(db, '127.0.0.1', 9000)
const now = { '.sv': 'timestamp' }, KEEP = 3000
let fails = 0
const NS = 'http://127.0.0.1:9000/%s?ns=demo-test-default-rtdb'
await fetch(NS.replace('%s', '.settings/rules.json'), { method: 'PUT', headers: { Authorization: 'Bearer owner' },
  body: readFileSync(new URL('database.rules.json', import.meta.url), 'utf8').replaceAll('2592000000', String(KEEP)) }).then(r => { if (!r.ok) throw Error('rules upload failed') })
const ok = async (label, p) => { try { await p; console.log('PASS  allowed:', label) } catch (e) { fails++; console.log('FAIL  denied :', label, e.message) } }
const no = async (label, p) => { try { await p; fails++; console.log('FAIL  allowed:', label) } catch { console.log('PASS  denied :', label) } }
const rules = { name: 'Test', mode: 'americano', courts: 2, points: 24, expected: 8, numRounds: null, status: 'lobby' }
const create = code => update(ref(db), { ['t/' + code]: { ...rules, created: now }, ['exp/' + code]: String(Date.now()) })
const sweep = async cutoff => {
  const s = await get(query(ref(db, 'exp'), orderByValue(), endAt(String(cutoff)), limitToFirst(50)))
  const codes = s.exists() ? Object.keys(s.val()) : []
  if (codes.length) await update(ref(db), Object.fromEntries(codes.flatMap(c => [['t/' + c, null], ['exp/' + c, null]])))
  return codes
}

await ok('create with exp index', create('ABCDE'))
await no('create without exp index', update(ref(db), { 't/BBBBB': { ...rules, created: now } }))
await no('create with client clock', update(ref(db), { 't/CCCCC': { ...rules, created: Date.now() }, 'exp/CCCCC': String(Date.now()) }))
await no('exp backdated at creation', update(ref(db), { 't/DDDDD': { ...rules, created: now }, 'exp/DDDDD': '1000000000000' }))
await no('bad code', create('abc'))
await ok('read live', get(ref(db, 't/ABCDE')).then(s => { if (!s.exists()) throw Error('missing') }))
await ok('read missing -> null', get(ref(db, 't/ZZZZZ')).then(s => { if (s.exists()) throw Error('exists') }))
await ok('join player', update(ref(db, 't/ABCDE'), { 'players/p1': { name: 'Ann', at: 1 } }))
await ok('remove player', update(ref(db, 't/ABCDE'), { 'players/p1': null }))
await no('change created', update(ref(db, 't/ABCDE'), { created: 1 }))
await no('wipe live tournament', update(ref(db), { 't/ABCDE': null }))
await no('wipe live exp entry', update(ref(db), { 'exp/ABCDE': null }))
await no('fake old exp entry', update(ref(db), { 'exp/FAKEX': '1000000000000' }))
await no('list all exp', get(ref(db, 'exp')))
await no('list exp incl. live', get(query(ref(db, 'exp'), orderByValue(), endAt(String(Date.now())))))
await no('list all tournaments', get(ref(db, 't')))
await ok('sweep before expiry finds nothing', sweep(Date.now() - KEEP - 1000).then(c => { if (c.length) throw Error(c) }))
await new Promise(r => setTimeout(r, KEEP + 1500))
await no('read expired', get(ref(db, 't/ABCDE')))
await ok('sweep deletes expired', sweep(Date.now() - KEEP - 1000).then(c => { if (c.join() !== 'ABCDE') throw Error('got ' + c) }))
await ok('exp gone after sweep', sweep(Date.now() - KEEP - 1000).then(c => { if (c.length) throw Error(c) }))
// Legacy tournament (no created/exp), seeded as admin.
await fetch(NS.replace('%s', 't/LEGAC.json'), { method: 'PUT', headers: { Authorization: 'Bearer owner' }, body: JSON.stringify(rules) })
await no('read legacy without created', get(ref(db, 't/LEGAC')))
await ok('recreate same code after sweep', create('ABCDE'))
console.log(fails ? `${fails} FAILED` : 'ALL PASSED')
process.exit(fails ? 1 : 0)
