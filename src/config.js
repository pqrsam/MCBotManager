const fs = require('node:fs')
const path = require('node:path')

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

function loadConfig (filePath) {
  if (!fs.existsSync(filePath)) return { exists: false, bots: [], error: null }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    const bots = normalizeBots(parsed?.bots)
    if (!Array.isArray(parsed?.bots)) {
      return { exists: true, bots, error: `${path.basename(filePath)}: "bots" is not an array` }
    }
    return { exists: true, bots, error: null }
  } catch (err) {
    return { exists: true, bots: [], error: `${path.basename(filePath)}: ${err.message}` }
  }
}

function saveConfig (filePath, bots) {
  try {
    fs.writeFileSync(filePath, JSON.stringify({ bots: normalizeBots(bots) }, null, 2) + '\n')
    return { ok: true, error: null }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

module.exports = { normalizeBots, loadConfig, saveConfig, configPath: path.join(__dirname, '..', 'config.json') }
