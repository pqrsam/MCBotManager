const { BotSession } = require('./bot-session')
const { formatLine } = require('./log-bus')

const POSITION_INTERVAL_MS = 1000

class BotManager {
  constructor (usernames, logBus, onChange = () => {}) {
    this.log = logBus
    this.onChange = onChange
    this.settings = null
    this.sessions = new Map()
    this.positionTimer = null
    for (const name of usernames) {
      const session = new BotSession(name, logBus, () => this.onChange())
      this.sessions.set(name, session)
    }
  }

  setSettings (settings) {
    this.settings = settings ? { ...settings } : null
    this.onChange()
  }

  session (username) { return this.sessions.get(username) }

  snapshots () { return [...this.sessions.values()].map(s => s.snapshot()) }

  connectAll () {
    if (!this.settings) return { started: [], skipped: [...this.sessions.keys()] }
    const started = []
    const skipped = []
    for (const s of this.sessions.values()) {
      if (s.status !== 'disconnected') { skipped.push(s.username); continue }
      try {
        s.connect(this.settings)
        started.push(s.username)
      } catch (err) {
        s.say('ERROR', `could not start: ${err.message}`)
        skipped.push(s.username)
      }
    }
    this.startPositionTimer()
    return { started, skipped }
  }

  connectOne (username) {
    const s = this.session(username)
    if (!s) return { ok: false, error: `unknown bot: ${username}` }
    if (!this.settings) return { ok: false, error: 'no server selected yet' }
    if (s.status !== 'disconnected') return { ok: false, error: 'already connecting or connected' }
    try {
      s.connect(this.settings)
      this.startPositionTimer()
      return { ok: true, error: null }
    } catch (err) {
      s.say('ERROR', `could not start: ${err.message}`)
      return { ok: false, error: err.message }
    }
  }

  disconnectAll (reason = 'disconnect.quitting') {
    try {
      for (const s of this.sessions.values()) {
        try { s.disconnect(reason) } catch (err) { this.log.emitGlobal(formatLine('ERROR', `${s.username} ${err.message}`)) }
      }
    } finally {
      this.stopPositionTimer()
    }
  }

  disconnectOne (username, reason = 'disconnect.quitting') {
    const s = this.session(username)
    if (!s) return
    try { s.disconnect(reason) } catch (err) { this.log.emitGlobal(formatLine('ERROR', `${s.username} ${err.message}`)) }
  }

  broadcast (text) {
    const sent = []
    const failed = []
    for (const s of this.sessions.values()) {
      try {
        const r = s.send(text)
        if (r.ok) sent.push(s.username)
        else failed.push(s.username)
      } catch (err) {
        s.say('ERROR', `send failed: ${err.message}`)
        failed.push(s.username)
      }
    }
    if (sent.length) this.log.emitGlobal(formatLine('SEND', `sent to ${sent.length} bot(s): ${text}`))
    if (failed.length) this.log.emitGlobal(formatLine('ERROR', `skipped ${failed.length} bot(s): ${failed.join(', ')}`))
    return { sent, failed }
  }

  startPositionTimer () {
    if (this.positionTimer) return
    this.positionTimer = setInterval(() => {
      let dirty = false
      for (const s of this.sessions.values()) {
        if (!s.posDirty) continue
        s.posDirty = false
        dirty = true
      }
      if (dirty) this.onChange()
    }, POSITION_INTERVAL_MS)
  }

  stopPositionTimer () {
    if (!this.positionTimer) return
    clearInterval(this.positionTimer)
    this.positionTimer = null
  }
}

module.exports = { BotManager }
