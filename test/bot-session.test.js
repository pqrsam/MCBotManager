const test = require('node:test')
const assert = require('node:assert')

const { parsePluginPayload, parseCoords, isTransferAction, BotSession } = require('../src/bot-session')
const { LogBus } = require('../src/log-bus')

test('parsePluginPayload splits Action and data on the NUL byte', () => {
  const buf = Buffer.from('Connect\u0000tbw-1', 'utf8')
  assert.deepStrictEqual(parsePluginPayload(buf), { action: 'Connect', data: 'tbw-1' })
})

test('parsePluginPayload handles an action with no data', () => {
  assert.deepStrictEqual(parsePluginPayload(Buffer.from('Connect\u0000')), { action: 'Connect', data: '' })
})

test('parsePluginPayload returns null for an empty payload', () => {
  assert.strictEqual(parsePluginPayload(Buffer.alloc(0)), null)
})

test('parsePluginPayload preserves the action case', () => {
  assert.strictEqual(parsePluginPayload(Buffer.from('Connect\u0000x')).action, 'Connect')
})

test('isTransferAction covers connect and transfer', () => {
  assert.strictEqual(isTransferAction('Connect'), true)
  assert.strictEqual(isTransferAction('transfer'), true)
  assert.strictEqual(isTransferAction('Forward'), false)
  assert.strictEqual(isTransferAction('Ping'), false)
})

test('parseCoords accepts integer strings', () => {
  assert.deepStrictEqual(parseCoords('120', '64', '-32'), { ok: true, pos: { x: 120, y: 64, z: -32 } })
})

test('parseCoords rejects non-integers and blanks', () => {
  assert.strictEqual(parseCoords('1.5', '64', '0').ok, false)
  assert.strictEqual(parseCoords('', '64', '0').ok, false)
  assert.strictEqual(parseCoords('abc', '64', '0').ok, false)
  assert.strictEqual(parseCoords('1.5', '64', '0').error, 'X, Y and Z must all be whole numbers')
})

test('a fresh session has no dig in flight and aborting a dig is a no-op', () => {
  const session = new BotSession('X', new LogBus(), () => {})
  assert.strictEqual(session.digTimer, null)
  assert.strictEqual(session.digFinish, null)
  assert.doesNotThrow(() => session._abortDig('disconnected'))
  assert.strictEqual(session.digTimer, null)
  assert.strictEqual(session.digFinish, null)
})

test('a spawn that throws leaves the session disconnected and retryable', () => {
  const mineflayer = require('mineflayer')
  const realCreateBot = mineflayer.createBot
  let attempts = 0
  mineflayer.createBot = () => { attempts++; throw new Error('Unsupported protocol version') }
  try {
    const session = new BotSession('X', new LogBus(), () => {})
    assert.throws(
      () => session.connect({ host: 'bad host', port: 25565, version: 'nope' }),
      /Unsupported protocol version/
    )
    assert.strictEqual(session.status, 'disconnected')
    assert.strictEqual(session.bot, null)
    assert.throws(() => session.connect({ host: 'bad host', port: 25565, version: 'nope' }))
    assert.strictEqual(attempts, 2)
  } finally {
    mineflayer.createBot = realCreateBot
  }
})

test('dig rejects a second concurrent dig while one is in flight', async () => {
  const session = new BotSession('X', new LogBus(), () => {})
  session.status = 'connected'
  session.bot = {}
  session.digFinish = () => {}
  const result = await session.dig(1, 64, 2)
  assert.deepStrictEqual(result, { ok: false, error: 'a dig is already in progress' })
})
