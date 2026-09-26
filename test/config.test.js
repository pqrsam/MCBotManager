const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { normalizeBots, normalizeServer, loadConfig, saveConfig } = require('../src/config')

function tmpFile (name) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bwt-')), name)
}

test('normalizeBots splits lines, trims, drops blanks and dedupes', () => {
  assert.deepStrictEqual(normalizeBots('A\n B \n\nA\nC,D\n'), ['A', 'B', 'C', 'D'])
})

test('normalizeBots accepts an array', () => {
  assert.deepStrictEqual(normalizeBots(['A', ' A ', '', 'B']), ['A', 'B'])
})

test('loadConfig reports missing file as first run, not an error', () => {
  const r = loadConfig(tmpFile('nope.json'))
  assert.strictEqual(r.exists, false)
  assert.strictEqual(r.error, null)
  assert.deepStrictEqual(r.bots, [])
})

test('loadConfig reads a valid file', () => {
  const f = tmpFile('config.json')
  fs.writeFileSync(f, JSON.stringify({ bots: ['A', 'B'] }))
  const r = loadConfig(f)
  assert.strictEqual(r.exists, true)
  assert.strictEqual(r.error, null)
  assert.deepStrictEqual(r.bots, ['A', 'B'])
})

test('loadConfig reports malformed JSON without throwing', () => {
  const f = tmpFile('config.json')
  fs.writeFileSync(f, '{ not json')
  const r = loadConfig(f)
  assert.strictEqual(r.exists, true)
  assert.match(r.error, /config\.json/)
  assert.deepStrictEqual(r.bots, [])
})

test('loadConfig rejects a non-array bots string without inventing bots', () => {
  const f = tmpFile('config.json')
  fs.writeFileSync(f, JSON.stringify({ bots: 'Steve' }))
  const r = loadConfig(f)
  assert.strictEqual(r.exists, true)
  assert.notStrictEqual(r.error, null)
  assert.match(r.error, /bots/)
  assert.deepStrictEqual(r.bots, [])
})

test('loadConfig rejects a non-array bots object without inventing bots', () => {
  const f = tmpFile('config.json')
  fs.writeFileSync(f, JSON.stringify({ bots: { a: 1 } }))
  const r = loadConfig(f)
  assert.strictEqual(r.exists, true)
  assert.notStrictEqual(r.error, null)
  assert.match(r.error, /bots/)
  assert.deepStrictEqual(r.bots, [])
})

test('saveConfig writes only the bots key when no server is given, then round-trips', () => {
  const f = tmpFile('config.json')
  const w = saveConfig(f, ['A', 'B'])
  assert.strictEqual(w.ok, true)
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(f, 'utf8')), { bots: ['A', 'B'] })
  assert.deepStrictEqual(loadConfig(f).bots, ['A', 'B'])
  assert.strictEqual(loadConfig(f).server, null)
})

test('saveConfig persists host, port and version alongside the bots', () => {
  const f = tmpFile('config.json')
  saveConfig(f, ['A'], { host: '10.0.0.5', port: 25566, version: '1.8.8' })
  const loaded = loadConfig(f)
  assert.deepStrictEqual(loaded.server, { host: '10.0.0.5', port: 25566, version: '1.8.8' })
  assert.deepStrictEqual(loaded.bots, ['A'])
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(f, 'utf8')), {
    bots: ['A'],
    server: { host: '10.0.0.5', port: 25566, version: '1.8.8' }
  })
})

test('normalizeServer coerces port strings and rejects junk', () => {
  assert.deepStrictEqual(normalizeServer({ host: ' h ', port: '25565', version: '1.8.8' }), { host: 'h', port: 25565, version: '1.8.8' })
  assert.strictEqual(normalizeServer({ host: '', port: 25565 }), null)
  assert.strictEqual(normalizeServer({ host: 'h', port: 0 }), null)
  assert.strictEqual(normalizeServer({ host: 'h', port: 70000 }), null)
  assert.strictEqual(normalizeServer({ host: 'h', port: 'abc' }), null)
  assert.strictEqual(normalizeServer(null), null)
  assert.strictEqual(normalizeServer('nope'), null)
  assert.deepStrictEqual(normalizeServer({ host: 'h', port: 25565 }), { host: 'h', port: 25565, version: '' })
})

test('an invalid server is dropped rather than persisted, and loading one yields null', () => {
  const f = tmpFile('config.json')
  saveConfig(f, ['A'], { host: 'h', port: 99999 })
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(f, 'utf8')), { bots: ['A'] })
  fs.writeFileSync(f, JSON.stringify({ bots: ['A'], server: { host: 'h', port: -1 } }))
  assert.strictEqual(loadConfig(f).server, null)
  assert.deepStrictEqual(loadConfig(f).bots, ['A'])
})

test('a config without a server key still loads cleanly', () => {
  const f = tmpFile('config.json')
  fs.writeFileSync(f, JSON.stringify({ bots: ['A', 'B'] }))
  const loaded = loadConfig(f)
  assert.strictEqual(loaded.error, null)
  assert.deepStrictEqual(loaded.bots, ['A', 'B'])
  assert.strictEqual(loaded.server, null)
})
