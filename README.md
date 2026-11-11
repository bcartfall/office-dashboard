# Office Dashboard

A dark, customizable **Chrome new-tab dashboard** for your work environment.
Vue 3 + Tailwind frontend, Node/Express backend.

- **Panels** you can drag around and resize (grid layout, auto-saved).
- **Plugins** inside panels — each has an icon + title, its own settings, and can be added any number of times.
- Plugin elements **auto-fill** their panel and re-flow as you add, remove, or drag them (even between panels).
- Plugins included: CPU load, Memory, Disk (usage + read/write speed), GPU (utilization + dedicated memory),
  Calendar (multiple ICS feeds, each with its own color), Launch App, Home Assistant buttons.

## Quick start

```bash
npm run install:all     # installs server/ and web/ dependencies
npm run build           # builds the Vue app into web/dist
npm start               # http://localhost:3944
```

Then make it your new tab page:

1. Open `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** → choose the `extension/` folder.
3. Open a new tab. (If you use another port, edit `DASHBOARD_URL` in `extension/newtab.js`.)

To use it as your **home page** instead: Chrome Settings → Appearance → *Show home button* → `http://localhost:3944`.

Keep it running in the background by starting it at login (Task Scheduler / launchd / systemd user service — `node server/index.js`).

### Development

```bash
npm run dev:server   # API on :3944 with auto-restart
npm run dev:web      # Vite on :5257 (proxies /api to :3944)
```

## Using it

- **Edit layout** (top right) unlocks drag, resize, panel rename/delete, and **+ Plugin**.
  Drag a panel by its header, resize from the bottom-right corner, drag a plugin card to reorder or move it to another panel.
- Hover a plugin → ⚙ opens **its own** settings (title, icon, update interval, …). Two CPU plugins can poll at different rates.
- Icons: a name (`rocket`, `mail`, `code`, …), any emoji, or an image URL.
- Layout and settings are saved to `data/layout.json` (and mirrored in browser storage if the server is down).

### Plugin settings

| Plugin | Settings |
| --- | --- |
| CPU Load | update interval, history length, per-core bars |
| Memory | update interval, history length, swap |
| Disk | volume, update interval, history length |
| GPU | which GPU, update interval, history length |
| Calendar | any number of ICS URLs (name + color each), days to show, refresh rate |
| Launch App | command / program / URL, launch arguments |
| Home Assistant | URL, long-lived token, refresh rate, action buttons |

**Calendar**: add as many ICS feeds as you like (Google/Outlook/iCloud "secret address", `webcal://` links work too).
Each feed gets a color that is shown in front of its events, e.g. `08:00-08:15 ● Dentist Appointment`; events from all feeds are
merged into one list sorted by time. A feed that fails to load shows an error without hiding the others.
The ICS URLs are stored in plain text in `data/layout.json`, like the Home Assistant token.

**Launch App** runs on the machine hosting the server. Examples: `code` + `--new-window C:\Projects`,
`C:\Program Files\App\app.exe` + `--profile work`, or a URL (opens in the default browser).

**Home Assistant**: create a *long-lived access token* (HA profile page), paste URL + token in the plugin settings,
press **Load entities** and pick one per button — label, action and icon are auto-filled. Buttons show the entity's on/off state.
You can also set `HA_URL` / `HA_TOKEN` environment variables for the server and leave the fields blank.

> GPU numbers depend on the driver: NVIDIA reports utilization and memory everywhere; other vendors may show "not reported".

## Adding a plugin

1. **Backend** — drop `server/plugins/my-plugin.js`:
   ```js
   export default {
     id: 'my-plugin', name: 'My Plugin', description: '…',
     routes(router) { router.get('/data', (req, res) => res.json({ hello: 'world' })); },
   };
   ```
   It is auto-mounted at `/api/plugins/my-plugin`.
2. **Frontend** — create `web/src/plugins/MyPlugin.vue` (receives a `config` prop; use `usePolling` for live data)
   and register it in `web/src/plugins/index.js` with its `defaults` and `settings` fields.

## Security notes

The API can launch programs, so it is locked down:

- listens on `127.0.0.1` only
- rejects requests whose `Host` isn't localhost (DNS-rebinding) or whose `Origin` isn't the dashboard itself
  (other websites can't trigger launches); extra origins via `ALLOWED_ORIGINS=https://a,https://b`
- mutating calls must be `application/json`
- programs are started without a shell (on Windows via `start`), with arguments passed as separate values

The Home Assistant token is stored in plain text in `data/layout.json` — keep that folder private, or use `HA_TOKEN` instead.

## Layout

```
server/    Express API (index.js, lib/, plugins/*.js)
web/       Vue 3 + Vite + Tailwind (src/plugins/*.vue, src/components, src/store)
extension/ Chrome new-tab override (Manifest V3)
data/      saved layout (created at runtime)
```
