const test = require('node:test')
const assert = require('node:assert')

const { parsePluginPayload, parseCoords, isTransferAction, BotSession, chatToText, describeReason } = require('../src/bot-session')
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

test('describeReason flattens a coloured anti-bot kick to readable text', () => {
  const reason = { "extra": [{"bold":true,"color":"dark_green","text":"TREXMINE"},"\n",{"color":"gray","text":"AntiBot Verification"},"\n\n",{"color":"gold","text":"You reconnected too fast."},"\n",{"color":"gray","text":"Please wait a few seconds before trying again."},{"extra":[{"color":"gray","text":"If this is a mistake, contact staff:"}," ",{"color":"green","text":"https://discord.gg/trexmine"}],"text":"\n\n"}],"text":"" }
  const out = describeReason(reason)
  assert.ok(out.includes('You reconnected too fast.'), out)
  assert.ok(out.includes('AntiBot Verification'), out)
  assert.ok(out.includes('https://discord.gg/trexmine'), out)
  assert.ok(!out.includes('{"extra"'), 'must not dump raw JSON')
  assert.ok(!out.includes('"color"'), 'must not dump raw JSON')
})

test('describeReason handles a JSON string, plain strings and odd input', () => {
  assert.strictEqual(describeReason('{"text":"bye"}'), 'bye')
  assert.strictEqual(describeReason('socketClosed'), 'socketClosed')
  assert.strictEqual(describeReason('not json {'), 'not json {')
  assert.strictEqual(describeReason(null), 'unknown')
  assert.strictEqual(describeReason(undefined), 'unknown')
  assert.strictEqual(describeReason(42), '42')
})

test('chatToText joins nested extra arrays in order', () => {
  assert.strictEqual(chatToText({ text: 'a', extra: ['b', { text: 'c' }] }), 'abc')
  assert.deepStrictEqual(chatToText(['x', 'y']), 'xy')
})

test('describeReason flattens the simplified-NBT anti-bot kick', () => {
  const reason = { "type": "compound", "value": { "extra": { "type": "list", "value": { "type": "compound", "value": [
    { "color": { "type": "string", "value": "dark_green" }, "bold": { "type": "byte", "value": 1 }, "text": { "type": "string", "value": "TREXMINE" } },
    { "": { "type": "string", "value": "\n" } },
    { "color": { "type": "string", "value": "gray" }, "text": { "type": "string", "value": "AntiBot Verification" } },
    { "": { "type": "string", "value": "\n\n" } },
    { "color": { "type": "string", "value": "red" }, "text": { "type": "string", "value": "You failed the AntiBot verification." } },
    { "": { "type": "string", "value": "\n" } },
    { "color": { "type": "string", "value": "gray" }, "text": { "type": "string", "value": "Please wait a few seconds before trying again." } },
    { "": { "type": "string", "value": "\n" } },
    { "color": { "type": "string", "value": "gold" }, "text": { "type": "string", "value": "Need help joining?" } },
    { "": { "type": "string", "value": " " } },
    { "color": { "type": "string", "value": "gray" }, "text": { "type": "string", "value": "https://discord.gg/trexmine" } },
    { "extra": { "type": "list", "value": { "type": "compound", "value": [
      { "color": { "type": "string", "value": "gray" }, "text": { "type": "string", "value": "If this is a mistake, contact staff:" } },
      { "": { "type": "string", "value": " " } },
      { "color": { "type": "string", "value": "green" }, "text": { "type": "string", "value": "https://discord.gg/trexmine" } }
    ] } }, "text": { "type": "string", "value": "\n\n" } }
  ] } }, "text": { "type": "string", "value": "" } } }
  const out = describeReason(reason)
  assert.strictEqual(out, [
    'TREXMINE',
    'AntiBot Verification',
    '',
    'You failed the AntiBot verification.',
    'Please wait a few seconds before trying again.',
    'Need help joining? https://discord.gg/trexmine',
    '',
    'If this is a mistake, contact staff: https://discord.gg/trexmine'
  ].join('\n'))
  assert.ok(!out.includes('"type"'), 'must not dump raw NBT')
  assert.ok(!out.includes('dark_green'), 'must not leak colour names')
  assert.ok(!out.includes('"value"'), 'must not dump raw NBT')
})

test('chatToText keeps newlines from empty-key separator nodes', () => {
  assert.strictEqual(chatToText({ '': { type: 'string', value: '\n' } }), '\n')
  assert.strictEqual(chatToText({ text: { type: 'string', value: 'a' }, extra: { type: 'list', value: { type: 'compound', value: [{ '': { type: 'string', value: '\n' } }, { text: { type: 'string', value: 'b' } }] } } }), 'a\nb')
})

test('chatToText ignores styling keys when falling back to unknown keys', () => {
  assert.strictEqual(chatToText({ color: { type: 'string', value: 'red' } }), '')
  assert.strictEqual(chatToText({ color: 'red', bold: 1, text: 'hi' }), 'hi')
})

test('clearing live state drops the cached position and health', () => {
  const session = new BotSession('X', new LogBus(), () => {})
  session.status = 'connected'
  session.latestPos = { x: 1, y: 2, z: 3 }
  session.health = 20
  session.posDirty = true
  session._clearLiveState()
  assert.deepStrictEqual(session.snapshot().pos, null)
  assert.strictEqual(session.snapshot().health, null)
  assert.strictEqual(session.posDirty, false)
})

test('a disconnected session reports no position', () => {
  const session = new BotSession('X', new LogBus(), () => {})
  session.status = 'connected'
  session.latestPos = { x: 10, y: 64, z: -5 }
  session._destroyBot()
  assert.strictEqual(session.status, 'disconnected')
  assert.deepStrictEqual(session.snapshot().pos, null)
})
