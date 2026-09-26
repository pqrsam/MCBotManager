const { contextBridge, ipcRenderer } = require('electron')

function on (channel, fn) {
  const wrapped = (_event, payload) => fn(payload)
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.off(channel, wrapped)
}

contextBridge.exposeInMainWorld('api', {
  config: {
    load: () => ipcRenderer.invoke('config:load'),
    save: (bots) => ipcRenderer.invoke('config:save', bots)
  },
  bots: {
    versions: () => ipcRenderer.invoke('bots:versions'),
    state: () => ipcRenderer.invoke('state:get'),
    connectAll: (settings) => ipcRenderer.invoke('connect:all', settings),
    connectOne: (username, settings) => ipcRenderer.invoke('connect:one', username, settings),
    disconnectAll: () => ipcRenderer.invoke('disconnect:all'),
    disconnectOne: (username) => ipcRenderer.invoke('disconnect:one', username),
    chat: (username, text) => ipcRenderer.invoke('bot:chat', username, text),
    command: (username, text) => ipcRenderer.invoke('bot:command', username, text),
    control: (username, control, state) => ipcRenderer.invoke('bot:control', username, control, state),
    stop: (username) => ipcRenderer.invoke('bot:stop', username),
    dig: (username, x, y, z) => ipcRenderer.invoke('bot:dig', username, x, y, z),
    broadcastChat: (text) => ipcRenderer.invoke('broadcast:chat', text),
    broadcastCommand: (text) => ipcRenderer.invoke('broadcast:command', text)
  },
  onStateChanged: (fn) => on('state:changed', fn),
  onLogLine: (fn) => on('log:line', fn),
  logHistory: (username) => ipcRenderer.invoke('logs:history', username ?? null)
})
