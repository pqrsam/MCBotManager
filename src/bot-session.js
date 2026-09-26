const mineflayer = require('mineflayer')
const { Vec3 } = require('vec3')
const { formatLine } = require('./log-bus')

const DIG_TIMEOUT_MS = 15000
const RECONNECT_DELAY_MS = 1000

function parsePluginPayload (buf) {
  if (!buf || buf.length === 0) return null
  const str = Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf)
  const nul = str.indexOf('\u0000')
  if (nul === -1) return { action: str, data: '' }
  return { action: str.slice(0, nul), data: str.slice(nul + 1) }
}

function isTransferAction (action) {
  const a = String(action || '').toLowerCase()
  return a === 'connect' || a === 'transfer'
}

function parseCoords (x, y, z) {
  const nums = [x, y, z].map(v => {
    if (typeof v === 'number') return v
    const s = String(v).trim()
    return s === '' ? NaN : Number(s)
  })
  if (nums.some(n => !Number.isInteger(n))) {
    return { ok: false, error: 'X, Y and Z must all be whole numbers' }
  }
  return { ok: true, pos: { x: nums[0], y: nums[1], z: nums[2] } }
}

class BotSession {
  constructor (username, logBus, onStateChange) {
    this.username = username
    this.log = logBus
    this.onStateChange = onStateChange || (() => {})
    this.status = 'disconnected'
    this.bot = null
    this.settings = null
    this.isTransferring = false
    this.reconnectTimer = null
    this.digTimer = null
    this.digFinish = null
    this.latestPos = null
    this.posDirty = false
    this.lastMoveLogAt = 0
    this.lastMoveLogKey = ''
    this.health = null
    this.sawRawPayload = false
  }

  say (tag, text) { this.log.emitBot(this.username, formatLine(tag, text)) }
  global (tag, text) { this.log.emitGlobal(formatLine(tag, `${this.username} ${text}`)) }

  setStatus (status) {
    this.status = status
    this.onStateChange(this.snapshot())
  }

  snapshot () {
    return {
      username: this.username,
      status: this.status,
      health: this.health,
      pos: this.latestPos ? { ...this.latestPos } : null,
      hasBot: this.bot !== null
    }
  }

  connect (settings) {
    this.settings = { ...settings }
    this.isTransferring = false
    this._spawnBot()
  }

  _clearTimers () {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null }
    if (this.digTimer) { clearTimeout(this.digTimer); this.digTimer = null }
  }

  _abortDig (reason) {
    if (this.digTimer) { clearTimeout(this.digTimer); this.digTimer = null }
    this.digFinish?.({ ok: false, error: reason })
  }

  _spawnBot () {
    this._clearTimers()
    this.setStatus('connecting')
    const { host, port, version } = this.settings
    this.say('EVENT', `connecting to ${host}:${port} (${version})`)
    this.global('EVENT', `connecting to ${host}:${port} (${version})`)

    const bot = mineflayer.createBot({
      host,
      port,
      username: this.username,
      version,
      auth: 'offline',
      logErrors: false,
      hideErrors: true
    })
    this.bot = bot

    bot.on('login', () => {
      this.say('EVENT', 'login packet received')
      try {
        bot._client.registerChannel('BungeeCord', ['string', 'restBuffer'])
        bot._client.on('BungeeCord', (payload) => this._onBungeePayload(payload))
      } catch (err) {
        this.say('ERROR', `could not register BungeeCord channel: ${err.message}`)
      }
    })

    bot.on('spawn', () => {
      this.setStatus('connected')
      this.latestPos = { x: bot.entity.position.x, y: bot.entity.position.y, z: bot.entity.position.z }
      this.posDirty = true
      this.say('EVENT', `spawned at ${this._fmtPos(this.latestPos)}`)
      this.global('EVENT', `connected (${this._fmtPos(this.latestPos)})`)
    })

    bot.on('game', () => this.say('EVENT', `game mode: ${bot.game?.gameMode ?? 'unknown'}`))
    bot.on('health', () => {
      this.health = bot.health
      this.onStateChange(this.snapshot())
    })
    bot.on('death', () => this.say('EVENT', 'death'))
    bot.on('respawn', () => this.say('EVENT', 'respawned'))

    bot.on('messagestr', (msg, position) => {
      const tag = position === 'chat' ? 'CHAT' : 'SYS'
      this.say(tag, msg)
    })

    bot.on('move', (pos) => {
      this.latestPos = { x: pos.x, y: pos.y, z: pos.z }
      this.posDirty = true
      const key = `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`
      const now = Date.now()
      if (key !== this.lastMoveLogKey && now - this.lastMoveLogAt >= 5000) {
        this.lastMoveLogAt = now
        this.lastMoveLogKey = key
        this.say('EVENT', `position: ${this._fmtPos(this.latestPos)}`)
      }
    })

    bot.on('error', (err) => {
      this.say('ERROR', err?.message ?? String(err))
      this.global('ERROR', `${this.username} ${err?.message ?? String(err)}`)
    })
    bot.on('kicked', (reason) => {
      const msg = typeof reason === 'string' ? reason : JSON.stringify(reason)
      this.say('EVENT', `kicked: ${msg}`)
      this.global('EVENT', `${this.username} kicked: ${msg}`)
    })
    bot.on('end', (reason) => {
      this.say('EVENT', `disconnected (${reason})`)
      if (!this.isTransferring) this.global('EVENT', `${this.username} disconnected (${reason})`)
      this._abortDig('disconnected')
      this.bot = null
      this.setStatus('disconnected')
    })
  }

  _fmtPos (p) {
    if (!p) return 'unknown'
    return `${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}`
  }

  _onBungeePayload (payload) {
    const parsed = parsePluginPayload(payload)
    if (!parsed) return
    if (!this.sawRawPayload) {
      this.sawRawPayload = true
      this.say('BUNGEE', `raw payload: ${JSON.stringify(parsed)}`)
    }
    if (!isTransferAction(parsed.action)) {
      this.say('BUNGEE', `ignoring action: ${parsed.action}`)
      return
    }
    const target = parsed.data || '(default)'
    this.say('BUNGEE', `transfer requested to ${target} - reconnecting to ${this.settings.host}:${this.settings.port}`)
    this.isTransferring = true
    this._destroyBot()
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (!this.isTransferring) return
      this.isTransferring = false
      this.say('BUNGEE', `reconnecting after transfer to ${target}`)
      this._spawnBot()
    }, RECONNECT_DELAY_MS)
  }

  _destroyBot () {
    this.stopMovement()
    this._abortDig('disconnected')
    if (this.bot) {
      try { this.bot.quit('transfer') } catch (_) {}
      this.bot = null
    }
    this.setStatus('disconnected')
  }

  disconnect (reason = 'disconnect.quitting') {
    this.isTransferring = false
    this._clearTimers()
    this._destroyBot()
    this.say('EVENT', `disconnect requested (${reason})`)
    this.global('EVENT', `${this.username} disconnect requested`)
  }

  send (text) {
    if (this.status !== 'connected' || !this.bot) {
      return { ok: false, error: 'bot is not connected' }
    }
    try {
      this.bot.chat(text)
      this.say('SEND', text)
      return { ok: true, error: null }
    } catch (err) {
      this.say('ERROR', `send failed: ${err.message}`)
      return { ok: false, error: err.message }
    }
  }

  setControl (control, state) {
    if (this.status !== 'connected' || !this.bot) return { ok: false, error: 'bot is not connected' }
    try {
      this.bot.setControlState(control, state)
      return { ok: true, error: null }
    } catch (err) {
      this.say('ERROR', `movement failed: ${err.message}`)
      return { ok: false, error: err.message }
    }
  }

  stopMovement () {
    if (!this.bot) return
    try { this.bot.clearControlStates() } catch (_) {}
  }

  async dig (x, y, z) {
    if (this.status !== 'connected' || !this.bot) {
      return { ok: false, error: 'bot is not connected' }
    }
    const parsed = parseCoords(x, y, z)
    if (!parsed.ok) {
      this.say('ERROR', parsed.error)
      return { ok: false, error: parsed.error }
    }
    const bot = this.bot
    const pos = new Vec3(parsed.pos.x, parsed.pos.y, parsed.pos.z)
    let block
    try {
      block = bot.blockAt(pos)
    } catch (err) {
      this.say('ERROR', `block lookup failed: ${err.message}`)
      return { ok: false, error: err.message }
    }
    if (!block) {
      const msg = `no block data at ${parsed.pos.x}, ${parsed.pos.y}, ${parsed.pos.z} (chunk not loaded?)`
      this.say('ERROR', msg)
      return { ok: false, error: msg }
    }
    if (block.name === 'air') {
      const msg = `no block at ${parsed.pos.x}, ${parsed.pos.y}, ${parsed.pos.z} - it is air`
      this.say('ERROR', msg)
      return { ok: false, error: msg }
    }
    if (!block.diggable) {
      const msg = `${block.name} at ${parsed.pos.x}, ${parsed.pos.y}, ${parsed.pos.z} is not diggable`
      this.say('ERROR', msg)
      return { ok: false, error: msg }
    }
    if (!bot.canDigBlock(block)) {
      const d = block.position.offset(0.5, 0.5, 0.5)
        .distanceTo(bot.entity.position.offset(0, 1.65, 0))
      const msg = `out of reach: ${block.name} at ${parsed.pos.x}, ${parsed.pos.y}, ${parsed.pos.z} is ${d.toFixed(1)} blocks away (max 5.1)`
      this.say('ERROR', msg)
      return { ok: false, error: msg }
    }

    this.say('BLOCK', `digging ${block.name} at ${parsed.pos.x}, ${parsed.pos.y}, ${parsed.pos.z}`)
    return new Promise((resolve) => {
      let settled = false
      const finish = (result) => {
        if (settled) return
        settled = true
        this.digFinish = null
        if (this.digTimer) { clearTimeout(this.digTimer); this.digTimer = null }
        resolve(result)
      }
      this.digFinish = finish
      this.digTimer = setTimeout(() => {
        try { bot.stopDigging() } catch (_) {}
        this.say('ERROR', `dig timed out after ${DIG_TIMEOUT_MS / 1000}s`)
        finish({ ok: false, error: 'dig timed out' })
      }, DIG_TIMEOUT_MS)

      bot.dig(block, true).then(() => {
        this.say('BLOCK', `broke ${block.name} at ${parsed.pos.x}, ${parsed.pos.y}, ${parsed.pos.z}`)
        finish({ ok: true, error: null })
      }).catch((err) => {
        if (settled) return
        this.say('ERROR', `dig failed: ${err.message}`)
        finish({ ok: false, error: err.message })
      })
    })
  }
}

module.exports = { BotSession, parsePluginPayload, parseCoords, isTransferAction }
