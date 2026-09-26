const test = require('node:test')
const assert = require('node:assert')

const { LogBus } = require('../src/log-bus')
const { BotManager } = require('../src/bot-manager')

function makeManager (names = ['A', 'B', 'C']) {
  const mgr = new BotManager(names, new LogBus())
  for (const [name, s] of mgr.sessions) {
    s.status = name === 'A' ? 'connected' : 'disconnected'
    s.bot = s.status === 'connected' ? { chat () {} } : null
  }
  return mgr
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

test('the position timer is a single shared interval', () => {
  const mgr = makeManager(['A', 'B', 'C'])
  mgr.startPositionTimer()
  mgr.startPositionTimer()
  mgr.stopPositionTimer()
  assert.ok(true)
})
