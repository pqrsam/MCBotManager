const test = require('node:test')
const assert = require('node:assert')

const { formatLine, LogBuffer, LogBus } = require('../src/log-bus')

test('formatLine produces [HH:MM:SS] [TAG] text', () => {
  const d = new Date(2026, 0, 2, 15, 42, 8)
  assert.strictEqual(formatLine('CHAT', 'hello', d), '[15:42:08] [CHAT] hello')
})

test('formatLine zero-pads single-digit hour, minute and second', () => {
  const d = new Date(2026, 0, 2, 9, 5, 3)
  assert.strictEqual(formatLine('CHAT', 'hello', d), '[09:05:03] [CHAT] hello')
})

test('LogBuffer keeps insertion order and assigns increasing ids', () => {
  const b = new LogBuffer()
  b.append('one')
  b.append('two')
  assert.deepStrictEqual(b.snapshot().map(l => l.text), ['one', 'two'])
  const ids = b.snapshot().map(l => l.id)
  assert.ok(ids[1] > ids[0])
})

test('LogBuffer drops oldest lines past the limit', () => {
  const b = new LogBuffer(3)
  for (const s of ['a', 'b', 'c', 'd', 'e']) b.append(s)
  assert.deepStrictEqual(b.snapshot().map(l => l.text), ['c', 'd', 'e'])
})

test('LogBuffer defaults to the 2000-line cap', () => {
  assert.strictEqual(new LogBuffer().limit, 2000)
})

test('LogBuffer drops its oldest line past the default cap', () => {
  const b = new LogBuffer()
  for (let i = 0; i < 2001; i++) b.append(`l${i}`)
  const lines = b.snapshot()
  assert.strictEqual(lines.length, 2000)
  assert.strictEqual(lines[0].text, 'l1')
  assert.strictEqual(lines[lines.length - 1].text, 'l2000')
})

test('LogBus defaults every buffer to the 2000-line cap', () => {
  const bus = new LogBus()
  assert.strictEqual(bus.limit, 2000)
  assert.strictEqual(bus.global.limit, 2000)
  assert.strictEqual(bus.forBot('A').limit, 2000)
})

test('LogBuffer ids stay unique after trimming', () => {
  const b = new LogBuffer(2)
  const trimmed = b.append('a')
  b.append('b')
  b.append('c')
  const ids = b.snapshot().map(l => l.id)
  assert.strictEqual(new Set(ids).size, 2)
  assert.ok(ids[1] > ids[0])
  assert.ok(!ids.includes(trimmed.id))
})

test('LogBus routes entries to per-bot buffers and the global buffer', () => {
  const bus = new LogBus()
  bus.emitBot('A', 'a-line')
  bus.emitGlobal('g-line')
  assert.deepStrictEqual(bus.forBot('A').snapshot().map(l => l.text), ['a-line'])
  assert.deepStrictEqual(bus.global.snapshot().map(l => l.text), ['g-line'])
  assert.deepStrictEqual(bus.forBot('B').snapshot(), [])
})

test('LogBus.subscribe receives pushes and can unsubscribe', () => {
  const bus = new LogBus()
  const seen = []
  const off = bus.subscribe(e => seen.push(e))
  bus.emitBot('A', 'x')
  bus.emitGlobal('y')
  off()
  bus.emitBot('A', 'z')
  assert.deepStrictEqual(seen.map(e => e.text), ['x', 'y'])
  assert.deepStrictEqual(seen.map(e => e.bot), ['A', null])
})
