const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { FileLog, formatFileLine } = require('../src/file-log')

function tmpDir () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bwt-logs-'))
}

const at = (h, m, s) => new Date(2026, 8, 26, h, m, s)

test('formatFileLine attributes a bot line to the receiving bot', () => {
  const out = formatFileLine({ bot: 'TestBot1', text: '[15:42:03] [CHAT] <Steve> hello' }, at(15, 42, 3))
  assert.strictEqual(out, '[2026-09-26 15:42:03] [TestBot1] [CHAT] <Steve> hello')
})

test('formatFileLine attributes an outbound line to the sending bot', () => {
  const out = formatFileLine({ bot: 'TestBot1', text: '[15:42:05] [SEND] /queue ranked' }, at(15, 42, 5))
  assert.strictEqual(out, '[2026-09-26 15:42:05] [TestBot1] [SEND] /queue ranked')
})

test('formatFileLine labels global lines as SYSTEM and keeps the full date', () => {
  const out = formatFileLine({ bot: null, text: '[15:42:10] [EVENT] TestBot1 disconnected' }, at(15, 42, 10))
  assert.strictEqual(out, '[2026-09-26 15:42:10] [SYSTEM] [EVENT] TestBot1 disconnected')
})

test('opening creates the logs dir, an archive dir and an empty latest.log', () => {
  const dir = tmpDir()
  const log = new FileLog(dir, 1024 * 1024, 100000).open()
  assert.ok(fs.existsSync(path.join(dir, 'archive')))
  assert.ok(fs.existsSync(log.latestPath))
  assert.strictEqual(fs.readFileSync(log.latestPath, 'utf8'), '')
  log.write('first line')
  log.flush()
  assert.strictEqual(fs.readFileSync(log.latestPath, 'utf8'), 'first line\n')
  log.close()
})

test('a run that logs nothing still leaves a fresh empty latest.log and archives the old one once', () => {
  const dir = tmpDir()
  const first = new FileLog(dir, 1024 * 1024, 100000).open()
  first.write('old session')
  first.flush()
  first.close()

  const second = new FileLog(dir, 1024 * 1024, 100000).open()
  second.close()

  assert.deepStrictEqual(fs.readdirSync(path.join(dir, 'archive')).length, 1)
  assert.strictEqual(fs.readFileSync(path.join(dir, 'latest.log'), 'utf8'), '')
})

test('flush batches many pending lines into one append', () => {
  const dir = tmpDir()
  const log = new FileLog(dir, 1024 * 1024, 100000).open()
  for (let i = 0; i < 50; i++) log.write(`line ${i}`)
  assert.ok(log.flush() > 0, 'flush reports the characters it wrote')
  assert.strictEqual(log.flush(), 0, 'flushing an empty buffer is a no-op')
  log.write('after empty flush')
  log.flush()
  const lines = fs.readFileSync(log.latestPath, 'utf8').trim().split('\n')
  assert.strictEqual(lines.length, 51)
  assert.strictEqual(lines[50], 'after empty flush')
  log.close()
})

test('an existing latest.log is archived when a new session opens', () => {
  const dir = tmpDir()
  const first = new FileLog(dir, 1024 * 1024, 100000).open()
  first.write('old session')
  first.flush()
  first.close()

  const second = new FileLog(dir, 1024 * 1024, 100000).open()
  second.write('new session')
  second.flush()
  second.close()

  assert.strictEqual(fs.readFileSync(path.join(dir, 'latest.log'), 'utf8'), 'new session\n')
  const archived = fs.readdirSync(path.join(dir, 'archive'))
  assert.strictEqual(archived.length, 1)
  assert.match(archived[0], /^latest-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.log$/)
  assert.strictEqual(fs.readFileSync(path.join(dir, 'archive', archived[0]), 'utf8'), 'old session\n')
})

test('an empty latest.log is discarded rather than archived', () => {
  const dir = tmpDir()
  fs.mkdirSync(path.join(dir, 'archive'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'latest.log'), '')
  const log = new FileLog(dir, 1024 * 1024, 100000).open()
  log.close()
  assert.deepStrictEqual(fs.readdirSync(path.join(dir, 'archive')), [])
})

test('crossing the size cap rolls the file into archive mid-session', () => {
  const dir = tmpDir()
  const log = new FileLog(dir, 40, 100000).open()
  log.write('aaaaaaaaaaaaaaaaaaaa')
  log.write('bbbbbbbbbbbbbbbbbbbb')
  log.flush()
  log.write('cccccccccccccccccccc')
  log.flush()
  log.close()
  const archived = fs.readdirSync(path.join(dir, 'archive'))
  assert.strictEqual(archived.length, 1)
  assert.strictEqual(fs.readFileSync(path.join(dir, 'latest.log'), 'utf8'), 'cccccccccccccccccccc\n')
})

test('two archives in the same second do not collide', () => {
  const dir = tmpDir()
  const a = new FileLog(dir, 1024 * 1024, 100000).open()
  a.write('one'); a.flush(); a.close()
  const b = new FileLog(dir, 1024 * 1024, 100000).open()
  b.write('two'); b.flush(); b.close()
  const c = new FileLog(dir, 1024 * 1024, 100000).open()
  c.write('three'); c.flush(); c.close()
  const archived = fs.readdirSync(path.join(dir, 'archive')).sort()
  assert.strictEqual(archived.length, 2)
  assert.strictEqual(new Set(archived).size, 2)
})
