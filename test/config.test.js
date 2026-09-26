const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { normalizeBots, loadConfig, saveConfig } = require('../src/config')

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

test('saveConfig writes only the bots key, then round-trips', () => {
  const f = tmpFile('config.json')
  const w = saveConfig(f, ['A', 'B'])
  assert.strictEqual(w.ok, true)
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(f, 'utf8')), { bots: ['A', 'B'] })
  assert.deepStrictEqual(loadConfig(f).bots, ['A', 'B'])
})
