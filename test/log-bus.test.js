const test = require('node:test')
const assert = require('node:assert')

const { formatLine, LogBuffer, LogBus } = require('../src/log-bus')

test('formatLine produces [HH:MM:SS] [TAG] text', () => {
  const d = new Date(2026, 0, 2, 15, 42, 8)
  assert.strictEqual(formatLine('CHAT', 'hello', d), '[15:42:08] [CHAT] hello')
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

test('LogBuffer ids stay unique after trimming', () => {
  const b = new LogBuffer(2)
  for (const s of ['a', 'b', 'c']) b.append(s)
  const ids = b.snapshot().map(l => l.id)
  assert.strictEqual(new Set(ids).size, 2)
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
