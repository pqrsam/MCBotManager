(() => {
  const api = window.api
  const CONSOLE_LIMIT = 2000

  const state = {
    bots: [],
    settings: null,
    selected: null,
    versions: [],
    hasConfig: false
  }

  const ui = {}
  const consoleState = {
    bot: { pending: [], nodes: [], lastId: 0 },
    global: { pending: [], nodes: [], lastId: 0 }
  }

  const $ = (id) => document.getElementById(id)
  const fmt = (p) => (p ? `${p.x.toFixed(0)}, ${p.y.toFixed(0)}, ${p.z.toFixed(0)}` : '-')

  function cacheUi () {
    for (const id of [
      'setup-screen', 'setup-textarea', 'setup-save', 'setup-cancel',
      'app-screen', 'header-server', 'header-version',
      'btn-connect-all', 'btn-disconnect-all', 'btn-edit-bots',
      'connect-dialog', 'connect-host', 'connect-port', 'connect-version', 'connect-confirm', 'connect-cancel',
      'bot-table-body', 'all-message', 'all-send-message', 'all-command', 'all-send-command',
      'bot-message', 'bot-send-chat', 'bot-command', 'bot-send-command',
      'btn-move-stop', 'dig-x', 'dig-y', 'dig-z', 'btn-dig',
      'selected-name', 'bot-console-title', 'bot-console', 'global-console', 'btn-toggle-global', 'fatal'
    ]) ui[id] = $(id)
  }

  function localLine (tag, text) {
    const d = new Date()
    const p = (n) => String(n).padStart(2, '0')
    return `[${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}] [${tag}] ${text}`
  }

  function fatal (message) {
    const el = ui.fatal
    if (!el) return
    el.textContent = message
    el.classList.remove('hidden')
  }

  function reportGlobalError (message) {
    fatal(message)
    pushLine('global', { id: 0, bot: null, text: localLine('ERROR', message) })
    const app = document.getElementById('app-screen')
    const setup = document.getElementById('setup-screen')
    if (app && setup && app.classList.contains('hidden') && setup.classList.contains('hidden')) {
      setup.classList.remove('hidden')
    }
  }

  function makeConsole (key, el) {
    const c = consoleState[key]
    c.el = el
    c.stick = true
    el.addEventListener('scroll', () => {
      c.stick = el.scrollTop + el.clientHeight >= el.scrollHeight - 4
    })
  }

  function scheduleFlush () {
    if (consoleState.raf) return
    consoleState.raf = requestAnimationFrame(() => {
      consoleState.raf = null
      flushConsole('bot')
      flushConsole('global')
    })
  }

  function flushConsole (key) {
    const c = consoleState[key]
    if (!c.el || c.pending.length === 0) return
    const frag = document.createDocumentFragment()
    for (const entry of c.pending) {
      if (entry.id <= c.lastId) continue
      c.lastId = entry.id
      const div = document.createElement('div')
      const m = entry.text.match(/^\[[\d:]+\] \[(\w+)\]/)
      if (m) {
        const tag = document.createElement('span')
        tag.className = `tag-${m[1]}`
        tag.textContent = `[${m[1]}] `
        div.appendChild(tag)
        div.appendChild(document.createTextNode(entry.text.slice(m[0].length)))
      } else {
        div.textContent = entry.text
      }
      frag.appendChild(div)
      c.nodes.push(div)
    }
    c.pending.length = 0
    c.el.appendChild(frag)
    if (c.nodes.length > CONSOLE_LIMIT) {
      const excess = c.nodes.splice(0, c.nodes.length - CONSOLE_LIMIT)
      for (const n of excess) n.remove()
    }
    if (c.stick) c.el.scrollTop = c.el.scrollHeight
  }

  function pushLine (key, entry) {
    consoleState[key].pending.push(entry)
    scheduleFlush()
  }

  function renderBots () {
    const tbody = ui['bot-table-body']
    const existing = new Map([...tbody.children].map(tr => [tr.dataset.name, tr]))

    for (const bot of state.bots) {
      let tr = existing.get(bot.username)
      if (!tr) {
        tr = document.createElement('tr')
        tr.className = 'clickable'
        tr.dataset.name = bot.username
        for (let i = 0; i < 5; i++) tr.appendChild(document.createElement('td'))
        tr.addEventListener('click', (ev) => {
          if (ev.target.tagName === 'BUTTON') return
          select(bot.username)
        })
        const btn = document.createElement('button')
        btn.addEventListener('click', (ev) => {
          ev.stopPropagation()
          const b = state.bots.find(x => x.username === ev.currentTarget.dataset.name)
          if (!b) return
          if (b.status === 'disconnected') {
            if (state.settings) api.bots.connectOne(b.username)
            else openConnectDialog(b.username)
          } else {
            api.bots.disconnectOne(b.username)
          }
        })
        tr.children[4].appendChild(btn)
        tbody.appendChild(tr)
      }
      existing.delete(bot.username)
      const [c0, c1, c2, c3, c4] = tr.children
      c0.textContent = bot.username
      c1.textContent = bot.status
      c1.className = `status-${bot.status}`
      c2.textContent = fmt(bot.pos)
      c3.textContent = bot.health ?? '-'
      const btn = c4.firstChild
      btn.dataset.name = bot.username
      btn.textContent = bot.status === 'disconnected' ? 'Connect' : 'Disconnect'
      btn.disabled = bot.status === 'connecting'
      tr.classList.toggle('selected', state.selected === bot.username)
    }

    for (const [name, tr] of existing) {
      tr.remove()
      if (state.selected === name) state.selected = null
    }
  }

  function renderHeader () {
    ui['header-server'].textContent = state.settings ? `${state.settings.host}:${state.settings.port}` : 'not selected'
    ui['header-version'].textContent = state.settings ? state.settings.version : '-'
    ui['selected-name'].textContent = state.selected || 'none'
    ui['bot-console-title'].textContent = state.selected ? `${state.selected} console` : 'Bot console'
    const has = state.bots.length > 0
    ui['btn-connect-all'].disabled = !has
    ui['btn-disconnect-all'].disabled = !has
    ui['all-send-message'].disabled = !has
    ui['all-send-command'].disabled = !has
    const none = !state.selected
    for (const id of ['bot-send-chat', 'bot-send-command', 'btn-move-stop', 'btn-dig']) ui[id].disabled = none
    for (const b of document.querySelectorAll('.movement .move')) b.disabled = none
  }

  function render () {
    renderBots()
    renderHeader()
  }

  async function select (username) {
    if (state.selected && state.selected !== username) api.bots.stop(state.selected)
    state.selected = username
    if (username) {
      const b = state.bots.find(x => x.username === username)
      if (b?.pos) {
        ui['dig-x'].value = String(Math.floor(b.pos.x))
        ui['dig-y'].value = String(Math.floor(b.pos.y))
        ui['dig-z'].value = String(Math.floor(b.pos.z))
      }
    }
    const c = consoleState.bot
    c.pending.length = 0
    for (const n of c.nodes) n.remove()
    c.nodes.length = 0
    c.lastId = 0
    if (username) {
      const history = await api.logHistory(username)
      for (const entry of history) {
        c.pending.push(entry)
        if (entry.id > c.lastId) c.lastId = entry.id
      }
      scheduleFlush()
    }
    render()
  }

  function applyState (payload) {
    state.bots = payload.bots || []
    state.settings = payload.settings || null
    state.hasConfig = payload.hasConfig
    if (state.selected && !state.bots.some(b => b.username === state.selected)) state.selected = null
    render()
  }

  function showSetup (prefill, isEdit) {
    ui['setup-textarea'].value = prefill.join('\n')
    ui['setup-cancel'].classList.toggle('hidden', !isEdit)
    ui['app-screen'].classList.add('hidden')
    ui['setup-screen'].classList.remove('hidden')
    ui['setup-textarea'].focus()
  }

  function showApp () {
    ui['setup-screen'].classList.add('hidden')
    ui['app-screen'].classList.remove('hidden')
    render()
  }

  function readConnectForm () {
    const host = ui['connect-host'].value.trim()
    const portRaw = ui['connect-port'].value.trim()
    const version = ui['connect-version'].value
    if (!host) return { ok: false, error: 'host is required' }
    const port = Number(portRaw)
    if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, error: 'port must be 1-65535' }
    if (!version) return { ok: false, error: 'version is required' }
    return { ok: true, settings: { host, port, version } }
  }

  function openConnectDialog (onlyFor = null) {
    if (state.settings) {
      ui['connect-host'].value = state.settings.host
      ui['connect-port'].value = String(state.settings.port)
      ui['connect-version'].value = state.settings.version
    }
    ui['connect-confirm'].textContent = onlyFor ? `Connect ${onlyFor}` : 'Connect All'
    ui['connect-dialog'].showModal()
  }

  function wireSend (inputId, buttonId, handler) {
    const input = ui[inputId]
    const go = async () => {
      const text = input.value.trim()
      if (!text) return
      input.value = ''
      await handler(text)
    }
    ui[buttonId].addEventListener('click', go)
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') go() })
  }

  function wireMovement () {
    for (const btn of document.querySelectorAll('.movement .move')) {
      const control = btn.dataset.control
      const momentary = btn.dataset.momentary
      const press = async (ev) => {
        ev.preventDefault()
        if (!state.selected) return
        if (momentary === 'jump') {
          await api.bots.control(state.selected, 'jump', true)
          await api.bots.control(state.selected, 'jump', false)
        } else {
          if (ev.pointerId != null && btn.setPointerCapture) btn.setPointerCapture(ev.pointerId)
          await api.bots.control(state.selected, control, true)
        }
      }
      const release = async (ev) => {
        if (!state.selected || momentary) return
        if (ev && ev.preventDefault) ev.preventDefault()
        await api.bots.control(state.selected, control, false)
      }
      btn.addEventListener('pointerdown', press)
      btn.addEventListener('pointerup', release)
      btn.addEventListener('pointercancel', release)
      btn.addEventListener('lostpointercapture', release)
    }
    ui['btn-move-stop'].addEventListener('click', () => {
      if (state.selected) api.bots.stop(state.selected)
    })
  }

  async function boot () {
    cacheUi()
    makeConsole('bot', ui['bot-console'])
    makeConsole('global', ui['global-console'])

    const cfg = await api.config.load()
    state.versions = await api.bots.versions()
    if (cfg.error) pushLine('global', { id: 0, bot: null, text: localLine('ERROR', cfg.error) })

    const sel = ui['connect-version']
    for (const v of state.versions) {
      const o = document.createElement('option')
      o.value = v
      o.textContent = v
      sel.appendChild(o)
    }
    const preferred = state.versions.find(v => v.startsWith('1.8'))
    if (preferred) sel.value = preferred

    if (!cfg.exists || cfg.error) {
      showSetup(cfg.bots, false)
    } else {
      showApp()
      applyState(await api.bots.state())
    }

    ui['setup-save'].addEventListener('click', async () => {
      const res = await api.config.save(ui['setup-textarea'].value.split('\n'))
      if (!res.ok) { pushLine('global', { id: 0, bot: null, text: localLine('ERROR', res.error) }); return }
      showApp()
      applyState(await api.bots.state())
    })

    ui['setup-cancel'].addEventListener('click', showApp)
    ui['btn-edit-bots'].addEventListener('click', () => {
      showSetup(state.bots.map(b => b.username), true)
    })

    ui['btn-connect-all'].addEventListener('click', () => openConnectDialog(null))
    ui['btn-disconnect-all'].addEventListener('click', () => api.bots.disconnectAll())
    ui['connect-cancel'].addEventListener('click', () => ui['connect-dialog'].close())
    ui['connect-confirm'].addEventListener('click', async () => {
      const form = readConnectForm()
      if (!form.ok) { pushLine('global', { id: 0, bot: null, text: localLine('ERROR', form.error) }); return }
      ui['connect-dialog'].close()
      await api.bots.connectAll(form.settings)
    })

    wireSend('bot-message', 'bot-send-chat', (text) => api.bots.chat(state.selected, text))
    wireSend('bot-command', 'bot-send-command', (text) => api.bots.command(state.selected, text))
    wireSend('all-message', 'all-send-message', (text) => api.bots.broadcastChat(text))
    wireSend('all-command', 'all-send-command', (text) => api.bots.broadcastCommand(text))

    wireMovement()

    ui['btn-dig'].addEventListener('click', async () => {
      if (!state.selected) return
      await api.bots.dig(state.selected, ui['dig-x'].value, ui['dig-y'].value, ui['dig-z'].value)
    })

    ui['btn-toggle-global'].addEventListener('click', (ev) => {
      const el = ui['global-console']
      el.classList.toggle('hidden')
      ev.target.textContent = el.classList.contains('hidden') ? 'show' : 'hide'
    })

    api.onStateChanged(applyState)
    api.onLogLine((entry) => {
      if (entry.bot === null) pushLine('global', entry)
      else if (entry.bot === state.selected) pushLine('bot', entry)
    })
  }

  window.addEventListener('error', (ev) => {
    reportGlobalError(`${ev.message} (${ev.filename}:${ev.lineno})`)
  })
  window.addEventListener('unhandledrejection', (ev) => {
    const reason = ev.reason
    reportGlobalError(`unhandled rejection: ${reason && reason.message ? reason.message : reason}`)
  })
  document.addEventListener('DOMContentLoaded', () => {
    boot().catch((err) => {
      reportGlobalError(`startup failed: ${err && err.message ? err.message : err}`)
    })
  })
})()
