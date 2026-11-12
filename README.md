# Office Dashboard

A dark, customizable **Chrome new-tab dashboard** for your work environment.
Vue 3 + Tailwind frontend, Node/Express backend.

- **Panels** you can drag around and resize (grid layout, auto-saved).
- **Plugins** inside panels — each has an icon + title, its own settings, and can be added any number of times.
- Plugins don't need a panel: in *Edit layout* mode use the header's **+ Plugin** to place one directly on the grid (it fills its cell like a panel does), or drag a plugin out of a panel onto empty grid space. Drag a standalone plugin's grip onto a panel to move it back in.
- Plugin elements **auto-fill** their panel and re-flow as you add, remove, or drag them (even between panels).
- Plugins included: CPU load, Memory, Disk (usage + read/write speed), GPU (utilization + dedicated memory),
  Calendar (Google Calendar API, any number of calendars each with its own color), Launch App (with hotkeys),
  Jellyfin "Up Next", Home Assistant buttons, Todo List (reorderable, checkable tasks with a right-click menu).
- The **page title** (browser tab) defaults to "Office Dashboard" and can be changed in *Edit layout* mode.

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

### Development

```bash
npm run dev:start-all  # both of the below, in one terminal
npm run dev:server     # API on :3943 with auto-restart (the --dev flag switches the ports)
npm run dev:web        # Vite on :5256 (proxies /api to :3943)
```

Development uses different ports from production (`npm start` = :3944), so both can run at once. They share
`data/layout.json`; each keeps its own graph history (`history.dev.db` vs `history.db`).

## Run in Background on Windows

Use task scheduler.

Open Windows Task Scheduler

1. Press `Win + R`.
2. Type `taskschd.msc`.
3. Press Enter.
4. Select **Create Task** (not Basic Task).

### General Tab

Configure the following:

- **Name:** Office Dashboard
- Select: Run only when user is logged on (recommended for desktop use).
- Check: Hidden.
- Configure for: Windows 10/11.

### Triggers Tab

1. Click **New**.
2. Set Begin the task to **At log on**.
3. Select your Windows user account.
4. Click OK.

### Actions Tab

1. Click **New**.
2. Select **Start a program**.
3. Configure the following:

| Field | Value |
|---|---|
| Program/script | `wscript.exe` |
| Add arguments | `start-dashboard.vbs` |
| Start in | `C:\path\to\office-dashboard` |

Replace `C:\path\to\office-dashboard` with your actual project directory.

**Note:** This assumes your server entry point is `server/index.js`.

### Conditions Tab

- Uncheck **Start the task only if the computer is on AC power**.

### Settings Tab

Enable:

- Allow task to be run on demand.
- If the task fails, restart every 1 minute.
- Attempt to restart up to 3 times.

Click OK to save the task.


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
| Calendar | Google account connection, which calendars to show (name + color each), days to show, refresh rate |
| Launch App | command / program / URL, launch arguments, hotkey |
| Jellyfin | server URL, API key, user, episodes to show, optional desktop-app command |
| Home Assistant | URL, long-lived token, refresh rate, action buttons |

**Calendar** uses the Google Calendar API (read-only), so every calendar on your account is available - including ones
shared with you or subscribed to, which have no secret ICS address. One-time setup:

1. In [Google Cloud Console](https://console.cloud.google.com/) create a project and enable the **Google Calendar API**.
2. *OAuth consent screen*: set it up (External is fine) and add your Google account as a **test user**.
3. *Credentials → Create credentials → OAuth client ID → application type **Desktop app***.
4. Open the Calendar plugin's settings, paste the client ID + secret, **Save client**, then **Connect Google Calendar**
   and approve. Tick the calendars you want; each gets its own color.

Only the refresh token and client secret are stored, in `data/google.json` (owner-only permissions); they never reach the
browser. While the consent screen is in "Testing" Google expires the token after 7 days - publish the app (or just
Connect again) to avoid that. `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` environment variables work too. Existing ICS
calendars from older versions are dropped on load.

**Graph history**: CPU, Memory, Disk and GPU are sampled by the *server* for every instance in your layout (using that
instance's own interval and history length), whether or not a browser is open, and saved to `data/history.db` (SQLite)
(restored after a restart). Graphs are filled as soon as the page loads, and a tab that was hidden catches up when you
return. The Calendar plugin refreshes its events in the background the same way, so it is ready on page load.

**Launch App hotkeys**: set a *Hotkey* in the tile's settings (click the field, press the keys). It is shown in the tile's
top-right corner and works while the dashboard tab has focus. Browsers can't register global shortcuts, and keep their own
(Ctrl+T, Ctrl+W, ...), so prefer single keys, F-keys or Alt+key.

**Jellyfin** shows each series' "Up Next" episode with thumbnail, series, episode code (`s12e02`) and episode title.
Create an API key in Jellyfin (Dashboard → Advanced → API Keys), enter the LAN URL (e.g. `http://192.168.1.20:8096`) and key,
press *Load users from Jellyfin* and pick yours. Clicking a thumbnail tells the **Jellyfin desktop app** to play that episode
(remote control through the server, so the app must be running and signed in to the same server). Set *Desktop app command*
to your `jellyfin-desktop` / `Jellyfin Media Player` executable and the dashboard will start it first if it isn't running.

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
