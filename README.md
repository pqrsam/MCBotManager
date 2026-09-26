# MCBotManager

A small desktop tool for spawning and controlling offline-mode (cracked) Minecraft test bots
against a local server, so a server-side plugin can be exercised manually from a real client.

Built on [Mineflayer](https://github.com/PrismarineJS/mineflayer) with an Electron UI.

## Requirements

- Node.js 22 or newer
- A Minecraft server running in offline/cracked mode

## Install

```bash
npm install
```

The `electron` package downloads its binary on install. If that step was skipped or failed:

```bash
node node_modules/electron/install.js
```

## Run

```bash
npm start
```

## First run

The app opens a setup screen. Enter one bot username per line and save. They are written to
`config.json` in the project root and reused on every launch. Use **Edit Bots** in the header to
change the list later.

`config.json` looks like this:

```json
{
  "bots": ["TestBot1", "TestBot2"],
  "server": { "host": "127.0.0.1", "port": 25565, "version": "1.8.8" }
}
```

The `server` block is filled in from the header fields and restored on the next launch. It is
omitted while the values are incomplete.

## Using it

Fill in **Host**, **Port** and **Version** in the header, then:

- **Connect All** / **Disconnect All** — connect or disconnect the whole roster
- **Connect** on a row — bring up a single bot using the header settings

Select a bot row to open its controls and its own console.

| Control | Notes |
|---|---|
| Message / command | One field. Anything starting with `/` is sent as a command. |
| `W` `A` `S` `D` | Press and hold to walk. Release to stop. |
| `Jump` | Momentary. |
| `Sneak` | Press and hold. |
| Break Block | Enter `X` `Y` `Z` and press **Break Block**. Selecting a bot fills these with its position. |
| Stop Breaking | Aborts a dig that is still in progress. |

Breaking uses Mineflayer's normal digging, so reach limits apply. If the block is too far away the
attempt is refused with the distance in the bot's console rather than hanging.

Send to All broadcasts to every connected bot; disconnected bots are skipped and reported.

## Consoles

Each bot has its own console showing its chat, sent messages, connection events, digs, transfers
and errors, with stack traces for errors. The global console shows session-level events only.

Both cap at 2000 lines.

## Server transfers

When the server sends a BungeeCord `Connect` message, the bot reconnects to the same host and port
to follow the transfer, keeping its console history. The first transfer of a session logs the raw
payload.

## Logs

Every console line is also written to `logs/latest.log`, tagged with the bot it belongs to:

```
[2026-09-26 23:08:41] [TestBot1] [CHAT] <Steve> hello
[2026-09-26 23:08:45] [TestBot1] [SEND] /queue ranked
[2026-09-26 23:08:41] [SYSTEM]     [EVENT] TestBot1 connected (120, 64, -32)
```

The previous session's log is moved to `logs/archive/` on the next launch, and the file rolls over
at 10 MB.

## Notes

- The app does not reconnect automatically after a kick. Reconnect at your own pace, since servers
  commonly rate-limit rapid reconnects.
- If the server is behind an anti-bot proxy, watch the bot console for kick reasons.
- `config.json` and `logs/` are gitignored, as is `test/`.

## Supported versions

The version dropdown is populated at runtime from the installed Mineflayer build
(`mineflayer.testedVersions`), currently 1.8.8 through 26.1.
