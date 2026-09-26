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

test('a transfer reconnect that cannot spawn does not throw out of the timer', async () => {
  const mineflayer = require('mineflayer')
  const realCreateBot = mineflayer.createBot
  const uncaught = []
  const onUncaught = (err) => uncaught.push(err)
  process.on('uncaughtException', onUncaught)
  let attempts = 0
  mineflayer.createBot = () => {
    attempts++
    if (attempts === 1) return { on () {}, clearControlStates () {}, quit () {} }
    throw new Error('Unsupported protocol version')
  }
  try {
    const log = new LogBus()
    const session = new BotSession('X', log, () => {})
    session.connect({ host: 'localhost', port: 25565, version: '1.8.9' })
    session._onBungeePayload(Buffer.from('Connect\u0000tbw-1', 'utf8'))
    const deadline = Date.now() + 5000
    while (attempts < 2 && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    assert.strictEqual(attempts, 2)
    assert.deepStrictEqual(uncaught, [])
    assert.strictEqual(session.status, 'disconnected')
    assert.ok(log.forBot('X').snapshot().some(l => l.text.includes('[ERROR] reconnect failed: Unsupported protocol version')))
    assert.ok(log.global.snapshot().some(l => l.text.includes('[ERROR] X reconnect failed: Unsupported protocol version')))
  } finally {
    process.off('uncaughtException', onUncaught)
    mineflayer.createBot = realCreateBot
  }
})

function fakeBotWithHandlers () {
  const handlers = new Map()
  const bot = {
    on (event, fn) { handlers.set(event, fn); return bot },
    clearControlStates () {},
    quit () {}
  }
  return { bot, handlers }
}

test('a kicked session logs the username exactly once in the global line', () => {
  const mineflayer = require('mineflayer')
  const realCreateBot = mineflayer.createBot
  const { bot, handlers } = fakeBotWithHandlers()
  mineflayer.createBot = () => bot
  try {
    const log = new LogBus()
    const session = new BotSession('TestBot1', log, () => {})
    session.connect({ host: 'localhost', port: 25565, version: '1.8.9' })
    handlers.get('kicked')('You were kicked for being AFK')
    const line = log.global.snapshot().find(l => l.text.includes('kicked'))
    assert.ok(line, 'expected a global kicked line')
    assert.match(line.text, /\[EVENT\] TestBot1 kicked: /)
    assert.doesNotMatch(line.text, /TestBot1 TestBot1/)
  } finally {
    mineflayer.createBot = realCreateBot
  }
})

test('a disconnecting session logs the username exactly once in the global line', () => {
  const mineflayer = require('mineflayer')
  const realCreateBot = mineflayer.createBot
  const { bot, handlers } = fakeBotWithHandlers()
  mineflayer.createBot = () => bot
  try {
    const log = new LogBus()
    const session = new BotSession('TestBot1', log, () => {})
    session.connect({ host: 'localhost', port: 25565, version: '1.8.9' })
    handlers.get('end')('disconnect.quitting')
    const line = log.global.snapshot().find(l => l.text.includes('disconnected ('))
    assert.ok(line, 'expected a global disconnected line')
    assert.match(line.text, /\[EVENT\] TestBot1 disconnected \(/)
    assert.doesNotMatch(line.text, /TestBot1 TestBot1/)
  } finally {
    mineflayer.createBot = realCreateBot
  }
})

test('a requested disconnect logs the username exactly once in the global line', () => {
  const mineflayer = require('mineflayer')
  const realCreateBot = mineflayer.createBot
  const { bot } = fakeBotWithHandlers()
  mineflayer.createBot = () => bot
  try {
    const log = new LogBus()
    const session = new BotSession('TestBot1', log, () => {})
    session.connect({ host: 'localhost', port: 25565, version: '1.8.9' })
    session.disconnect('disconnect.quitting')
    const line = log.global.snapshot().find(l => l.text.includes('disconnect requested'))
    assert.ok(line, 'expected a global disconnect requested line')
    assert.match(line.text, /\[EVENT\] TestBot1 disconnect requested/)
    assert.doesNotMatch(line.text, /TestBot1 TestBot1/)
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
