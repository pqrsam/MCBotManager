const path = require('node:path')
const { app, BrowserWindow, Menu, ipcMain } = require('electron')
const mineflayer = require('mineflayer')

const { loadConfig, saveConfig, configPath } = require('./config')
const { LogBus, formatLine } = require('./log-bus')
const { BotManager } = require('./bot-manager')
const { FileLog, formatFileLine } = require('./file-log')

let win = null
let logBus = null
let fileLog = null
let manager = null
let configState = { exists: false, bots: [], server: null }

function state () {
  return {
    bots: manager ? manager.snapshots() : [],
    settings: manager ? manager.settings : null,
    hasConfig: configState.exists,
    server: configState.server
  }
}

function pushState () {
  if (win && !win.isDestroyed()) win.webContents.send('state:changed', state())
}

function rebuildRoster (bots) {
  const previous = manager
  manager = new BotManager(bots, logBus, pushState)
  if (previous) previous.disconnectAll('config changed')
  pushState()
}

function createWindow () {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    backgroundColor: '#14161a',
    title: 'Minecraft Bot Tester',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  Menu.setApplicationMenu(null)
  win.setMenuBarVisibility(false)
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'))
  win.on('closed', () => { win = null })
}

function registerIpc () {
  ipcMain.handle('config:load', () => {
    configState = loadConfig(configPath)
    return configState
  })

  ipcMain.handle('config:save', (_e, bots) => {
    const res = saveConfig(configPath, bots, configState.server)
    if (res.ok) {
      configState = loadConfig(configPath)
      rebuildRoster(configState.bots)
    }
    return res
  })

  ipcMain.handle('config:setServer', (_e, server) => {
    const res = saveConfig(configPath, configState.bots, server)
    if (res.ok) configState = loadConfig(configPath)
    return { ok: res.ok, error: res.error, server: configState.server }
  })

  ipcMain.handle('bots:versions', () => mineflayer.testedVersions.slice())

  ipcMain.handle('state:get', () => state())

  ipcMain.handle('connect:all', (_e, settings) => {
    manager.setSettings(settings)
    return manager.connectAll()
  })

  ipcMain.handle('connect:one', (_e, username, settings) => {
    if (settings) manager.setSettings(settings)
    return manager.connectOne(username)
  })

  ipcMain.handle('disconnect:all', () => {
    manager.disconnectAll()
    return { ok: true }
  })

  ipcMain.handle('disconnect:one', (_e, username) => {
    manager.disconnectOne(username)
    return { ok: true }
  })

  ipcMain.handle('bot:chat', (_e, username, text) => {
    const s = manager.session(username)
    return s ? s.send(text) : { ok: false, error: `unknown bot: ${username}` }
  })

  ipcMain.handle('bot:control', (_e, username, control, value) => {
    const s = manager.session(username)
    return s ? s.setControl(control, value) : { ok: false, error: `unknown bot: ${username}` }
  })

  ipcMain.handle('bot:stop', (_e, username) => {
    const s = manager.session(username)
    if (s) s.stopMovement()
    return { ok: true }
  })

  ipcMain.handle('bot:stop-dig', (_e, username) => {
    const s = manager.session(username)
    return s ? s.stopDigging() : { ok: false, error: `unknown bot: ${username}` }
  })

  ipcMain.handle('bot:dig', (_e, username, x, y, z) => {
    const s = manager.session(username)
    if (!s) return Promise.resolve({ ok: false, error: `unknown bot: ${username}` })
    return s.dig(x, y, z)
  })

  ipcMain.handle('broadcast:chat', (_e, text) => manager.broadcast(text))

  ipcMain.handle('logs:history', (_e, username) => {
    const buf = username == null ? logBus.global : logBus.forBot(username)
    return buf.snapshot().map(l => ({ id: l.id, bot: username ?? null, text: l.text }))
  })
}

app.whenReady().then(() => {
  logBus = new LogBus(2000)
  fileLog = new FileLog().open()
  configState = loadConfig(configPath)
  if (configState.error) logBus.emitGlobal(formatLine('ERROR', configState.error))
  manager = new BotManager(configState.bots, logBus, pushState)

  logBus.subscribe((entry) => {
    fileLog.write(formatFileLine(entry))
  })

  logBus.subscribe((entry) => {
    if (win && !win.isDestroyed()) win.webContents.send('log:line', entry)
  })

  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (manager) manager.disconnectAll('app closing')
  if (fileLog) fileLog.close()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  if (manager) manager.disconnectAll('app closing')
  if (fileLog) fileLog.close()
})
