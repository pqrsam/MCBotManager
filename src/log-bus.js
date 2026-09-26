const { EventEmitter } = require('node:events')

let nextId = 1

function pad (n) { return String(n).padStart(2, '0') }

function formatLine (tag, text, date = new Date()) {
  const t = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  return `[${t}] [${tag}] ${text}`
}

class LogBuffer {
  constructor (limit = 2000) {
    this.limit = limit
    this.lines = []
  }

  append (text) {
    const entry = { id: nextId++, text }
    this.lines.push(entry)
    if (this.lines.length > this.limit) this.lines.splice(0, this.lines.length - this.limit)
    return entry
  }

  clear () { this.lines = [] }
  snapshot () { return this.lines.slice() }
}

class LogBus extends EventEmitter {
  constructor (limit = 2000) {
    super()
    this.setMaxListeners(0)
    this.limit = limit
    this.global = new LogBuffer(limit)
    this.buffers = new Map()
  }

  forBot (username) {
    let buf = this.buffers.get(username)
    if (!buf) { buf = new LogBuffer(this.limit); this.buffers.set(username, buf) }
    return buf
  }

  emitBot (username, text) {
    const entry = this.forBot(username).append(text)
    this.emit('line', { id: entry.id, bot: username, text })
    return entry
  }

  emitGlobal (text) {
    const entry = this.global.append(text)
    this.emit('line', { id: entry.id, bot: null, text })
    return entry
  }

  subscribe (fn) {
    this.on('line', fn)
    return () => this.off('line', fn)
  }
}

module.exports = { formatLine, LogBuffer, LogBus }
