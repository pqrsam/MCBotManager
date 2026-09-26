const fs = require('node:fs')
const path = require('node:path')

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024
const DEFAULT_FLUSH_MS = 250

function pad (n) { return String(n).padStart(2, '0') }

function stamp (date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
}

function formatFileLine (entry, date = new Date()) {
  const ts = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  const body = entry.text.replace(/^\[[\d:]+\]\s*/, '')
  return `[${ts}] [${entry.bot || 'SYSTEM'}] ${body}`
}

class FileLog {
  constructor (dir = path.join(__dirname, '..', 'logs'), maxBytes = DEFAULT_MAX_BYTES, flushMs = DEFAULT_FLUSH_MS) {
    this.dir = dir
    this.archiveDir = path.join(dir, 'archive')
    this.latestPath = path.join(dir, 'latest.log')
    this.maxBytes = maxBytes
    this.flushMs = flushMs
    this.pending = []
    this.bytes = 0
    this.timer = null
  }

  open () {
    fs.mkdirSync(this.archiveDir, { recursive: true })
    this._archiveExisting()
    fs.closeSync(fs.openSync(this.latestPath, 'a'))
    this.bytes = fs.statSync(this.latestPath).size
    if (!this.timer) {
      this.timer = setInterval(() => this.flush(), this.flushMs)
      if (this.timer.unref) this.timer.unref()
    }
    return this
  }

  _archiveExisting () {
    if (!fs.existsSync(this.latestPath)) return
    if (fs.statSync(this.latestPath).size === 0) {
      fs.unlinkSync(this.latestPath)
      return
    }
    fs.renameSync(this.latestPath, this._freeArchivePath())
  }

  _freeArchivePath () {
    const base = stamp()
    let candidate = path.join(this.archiveDir, `latest-${base}.log`)
    let n = 1
    while (fs.existsSync(candidate)) {
      candidate = path.join(this.archiveDir, `latest-${base}-${n}.log`)
      n++
    }
    return candidate
  }

  write (line) {
    this.pending.push(line)
    return true
  }

  flush () {
    if (this.pending.length === 0) return 0
    const data = this.pending.join('\n') + '\n'
    this.pending.length = 0
    fs.appendFileSync(this.latestPath, data, 'utf8')
    this.bytes += Buffer.byteLength(data, 'utf8')
    if (this.bytes >= this.maxBytes) {
      this._archiveExisting()
      this.bytes = 0
    }
    return data.length
  }

  close () {
    if (this.timer) { clearInterval(this.timer); this.timer = null }
    this.flush()
  }
}

module.exports = { FileLog, formatFileLine, DEFAULT_MAX_BYTES, DEFAULT_FLUSH_MS }
