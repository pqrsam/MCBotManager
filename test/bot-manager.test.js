const test = require('node:test')
const assert = require('node:assert')

const { LogBus } = require('../src/log-bus')
const { BotManager } = require('../src/bot-manager')

function makeManager (names = ['A', 'B', 'C'], onChange = () => {}) {
  const mgr = new BotManager(names, new LogBus(), onChange)
  for (const [name, s] of mgr.sessions) {
    s.status = name === 'A' ? 'connected' : 'disconnected'
    s.bot = s.status === 'connected' ? { chat () {} } : null
  }
  return mgr
}

function withFakeTimers (fn) {
  const realSetInterval = globalThis.setInterval
  const realClearInterval = globalThis.clearInterval
  const created = []
  const cleared = []
  globalThis.setInterval = (cb, ms) => {
    const handle = { ms }
    created.push({ cb, ms, handle })
    return handle
  }
  globalThis.clearInterval = (handle) => { cleared.push(handle) }
  try {
    fn({ created, cleared })
  } finally {
    globalThis.setInterval = realSetInterval
    globalThis.clearInterval = realClearInterval
  }
}

test('sessions are created for every configured username', () => {
  const mgr = makeManager(['A', 'B'])
  assert.deepStrictEqual([...mgr.sessions.keys()], ['A', 'B'])
})

test('snapshots report each bot status', () => {
  const mgr = makeManager(['A', 'B'])
  const byName = Object.fromEntries(mgr.snapshots().map(s => [s.username, s.status]))
  assert.deepStrictEqual(byName, { A: 'connected', B: 'disconnected' })
})

test('broadcast sends to connected bots and skips the rest', () => {
  const mgr = makeManager()
  const r = mgr.broadcast('hello')
  assert.deepStrictEqual(r.sent, ['A'])
  assert.deepStrictEqual(r.failed, ['B', 'C'])
})

test('broadcast isolates a throwing bot and keeps going', () => {
  const mgr = makeManager(['A', 'B'])
  mgr.session('A').bot.chat = () => { throw new Error('boom') }
  const r = mgr.broadcast('hi')
  assert.deepStrictEqual(r.sent, [])
  assert.deepStrictEqual(r.failed, ['A', 'B'])
})

test('broadcast with no connected bots does not throw', () => {
  const mgr = new BotManager(['A', 'B'], new LogBus())
  assert.deepStrictEqual(mgr.broadcast('x'), { sent: [], failed: ['A', 'B'] })
})

test('disconnectOne is safe for an unknown username', () => {
  const mgr = makeManager(['A'])
  assert.doesNotThrow(() => mgr.disconnectOne('nope'))
})

test('starting the position timer twice keeps a single 1000ms interval', () => {
  withFakeTimers(({ created }) => {
    const mgr = makeManager()
    mgr.startPositionTimer()
    const handle = mgr.positionTimer
    assert.ok(handle)
    mgr.startPositionTimer()
    assert.strictEqual(mgr.positionTimer, handle)
    assert.strictEqual(created.length, 1)
    assert.strictEqual(created[0].ms, 1000)
  })
})

test('stopping the position timer is safe when not started and when repeated', () => {
  withFakeTimers(({ created, cleared }) => {
    const mgr = makeManager()
    assert.strictEqual(mgr.positionTimer, null)
    assert.doesNotThrow(() => mgr.stopPositionTimer())
    assert.strictEqual(created.length, 0)
    mgr.startPositionTimer()
    const handle = mgr.positionTimer
    assert.doesNotThrow(() => mgr.stopPositionTimer())
    assert.doesNotThrow(() => mgr.stopPositionTimer())
    assert.strictEqual(mgr.positionTimer, null)
    assert.strictEqual(cleared.length, 1)
    assert.strictEqual(cleared[0], handle)
  })
})

test('the position timer restarts after being stopped', () => {
  withFakeTimers(({ created }) => {
    let pushes = 0
    const mgr = makeManager(['A'], () => { pushes++ })
    mgr.startPositionTimer()
    const first = mgr.positionTimer
    mgr.stopPositionTimer()
    assert.strictEqual(mgr.positionTimer, null)
    mgr.startPositionTimer()
    assert.ok(mgr.positionTimer)
    assert.notStrictEqual(mgr.positionTimer, first)
    assert.strictEqual(created.length, 2)
    mgr.session('A').posDirty = true
    created[1].cb()
    assert.strictEqual(pushes, 1)
  })
})

test('a position tick with dirty sessions pushes onChange exactly once', () => {
  withFakeTimers(({ created }) => {
    let pushes = 0
    const mgr = makeManager(['A', 'B', 'C'], () => { pushes++ })
    mgr.startPositionTimer()
    for (const s of mgr.sessions.values()) s.posDirty = true
    created[0].cb()
    assert.strictEqual(pushes, 1)
    assert.deepStrictEqual([...mgr.sessions.values()].map(s => s.posDirty), [false, false, false])
  })
})

test('a position tick with nothing dirty pushes nothing', () => {
  withFakeTimers(({ created }) => {
    let pushes = 0
    const mgr = makeManager(['A', 'B', 'C'], () => { pushes++ })
    mgr.startPositionTimer()
    created[0].cb()
    assert.strictEqual(pushes, 0)
    mgr.session('A').posDirty = true
    created[0].cb()
    assert.strictEqual(pushes, 1)
    created[0].cb()
    assert.strictEqual(pushes, 1)
  })
})
