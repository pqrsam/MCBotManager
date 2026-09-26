const fs = require('node:fs')
const path = require('node:path')

const DEFAULT_SERVER = { host: '127.0.0.1', port: 25565, version: '' }

function normalizeBots (input) {
  const list = Array.isArray(input) ? input : String(input ?? '').split(/[\n,]/)
  const out = []
  const seen = new Set()
  for (const raw of list) {
    const name = String(raw).trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out
}

function normalizeServer (input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const host = typeof input.host === 'string' ? input.host.trim() : ''
  const port = typeof input.port === 'number' ? input.port : Number(input.port)
  const version = typeof input.version === 'string' ? input.version.trim() : ''
  if (!host) return null
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null
  return { host, port, version }
}

function loadConfig (filePath) {
  if (!fs.existsSync(filePath)) return { exists: false, bots: [], server: null, error: null }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    if (!Array.isArray(parsed?.bots)) {
      return { exists: true, bots: [], server: null, error: `${path.basename(filePath)}: "bots" is not an array` }
    }
    return {
      exists: true,
      bots: normalizeBots(parsed.bots),
      server: normalizeServer(parsed.server),
      error: null
    }
  } catch (err) {
    return { exists: true, bots: [], server: null, error: `${path.basename(filePath)}: ${err.message}` }
  }
}

function saveConfig (filePath, bots, server) {
  const payload = { bots: normalizeBots(bots) }
  const normalizedServer = normalizeServer(server)
  if (normalizedServer) payload.server = normalizedServer
  try {
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + '\n')
    return { ok: true, error: null }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

module.exports = { normalizeBots, normalizeServer, loadConfig, saveConfig, DEFAULT_SERVER, configPath: path.join(__dirname, '..', 'config.json') }
