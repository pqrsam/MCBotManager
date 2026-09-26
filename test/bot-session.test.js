const test = require('node:test')
const assert = require('node:assert')

const { parsePluginPayload, parseCoords, isTransferAction } = require('../src/bot-session')

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

test('parsePluginPayload lowercases the action for comparison', () => {
  assert.strictEqual(parsePluginPayload(Buffer.from('Connect\u0000x')).action.toLowerCase(), 'connect')
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
