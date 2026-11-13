/**
 * Jellyfin bridge (LAN server). Each plugin instance passes its own url / API key / user id, so the
 * browser never talks to Jellyfin directly: no CORS problems, and the API key stays out of image URLs.
 *
 *  POST /users    list the server's users (to pick one in the settings)
 *  POST /nextup   the user's "Next Up" episodes
 *  GET  /image    proxied thumbnail (uses the connection registered by the last /nextup call)
 *  POST /play     play an episode in the Jellyfin *desktop app* by remote-controlling its session
 *
 * Create the API key in Jellyfin: Dashboard -> Advanced -> API Keys.
 */
import crypto from 'node:crypto';
import { launch, splitArgs } from './launch-app.js';
import { resilientFetch, describeNetError } from '../lib/net.js';
import { focusAppInBackground, processNameFromCommand } from '../lib/focus.js';

const ID_RE = /^[0-9a-f-]{32,36}$/i;
const IMAGE_TYPES = new Set(['Primary', 'Thumb', 'Backdrop']);
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

export default {
  id: 'jellyfin',
  name: 'Jellyfin',
  description: 'Up Next episodes from your Jellyfin server',
  routes(router) {
    router.post('/users', async (req, res) => {
      const conn = connection(req.body);
      const users = await jf(conn, 'GET', '/Users');
      res.json((Array.isArray(users) ? users : []).map((u) => ({ id: u.Id, name: u.Name })).sort((a, b) => a.name.localeCompare(b.name)));
    });

    router.post('/nextup', async (req, res) => {
      const conn = connection(req.body);
      const userId = requireId(req.body?.userId, 'userId');
      const limit = clamp(Math.round(Number(req.body?.limit) || 8), 1, 40);
      const r = await jf(conn, 'GET', '/Shows/NextUp', {
        userId,
        limit,
        fields: 'PrimaryImageAspectRatio',
        enableUserData: true,
        enableImageTypes: 'Primary,Thumb,Backdrop',
        imageTypeLimit: 1,
      });
      res.json({ conn: register(conn), items: (r.Items || []).map(toItem) });
    });

    router.get('/image', async (req, res) => {
      const conn = connections.get(String(req.query.c || ''));
      if (!conn) return res.status(404).end(); // server restarted: the page re-registers on its next refresh
      const id = String(req.query.id || '');
      const type = String(req.query.type || 'Primary');
      if (!ID_RE.test(id) || !IMAGE_TYPES.has(type)) return res.status(400).end();
      const params = { maxWidth: clamp(Number(req.query.w) || 480, 80, 1000), quality: 80 };
      if (req.query.tag) params.tag = String(req.query.tag).slice(0, 64);
      const r = await jfRaw(conn, `/Items/${id}/Images/${type}`, params);
      if (!r.ok) return res.status(r.status === 404 ? 404 : 502).end();
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > MAX_IMAGE_BYTES) return res.status(502).end();
      res.set('Content-Type', r.headers.get('content-type') || 'image/jpeg');
      // the image tag is part of the URL, so a changed image gets a new URL
      res.set('Cache-Control', 'private, max-age=86400');
      res.send(buf);
    });

    router.post('/play', async (req, res) => {
      const conn = connection(req.body);
      const itemId = requireId(req.body?.itemId, 'itemId');
      const userId = req.body?.userId ? requireId(req.body.userId, 'userId') : null;
      const wanted = String(req.body?.client || 'Jellyfin Desktop|Jellyfin Media Player')
        .split(/[|,]/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      const command = String(req.body?.command || '').trim();
      const ticks = Math.max(0, Math.round(Number(req.body?.resumeTicks) || 0));

      let session = await findSession(conn, wanted, userId);
      let launched = false;
      if (!session && command) {
        if (/[\0\r\n]/.test(command)) return res.status(400).json({ error: 'Invalid characters in command' });
        try {
          await launch(command, splitArgs(String(req.body?.args || '')));
        } catch (err) {
          throw httpError(500, `Could not start "${command}": ${err.message}`);
        }
        launched = true;
        // the app registers a session with the server once it has started and signed in
        for (let i = 0; i < 30 && !session; i++) {
          await sleep(1000);
          session = await findSession(conn, wanted, userId);
        }
      }
      if (!session) {
        throw httpError(
          404,
          command
            ? `Started "${command}" but it did not appear on the server within 30 s - is it signed in to this Jellyfin server?`
            : 'The Jellyfin desktop app isn’t running (no controllable session found). Start it, or set “Desktop app command” in the plugin settings.'
        );
      }
      await jf(conn, 'POST', `/Sessions/${session.Id}/Playing`, { playCommand: 'PlayNow', itemIds: itemId, ...(ticks ? { startPositionTicks: ticks } : {}) });
      // Bring the desktop app's window forward (it keeps running in the background otherwise).
      if (req.body?.foreground !== false) {
        const procs = ['jellyfin', processNameFromCommand(command), ...wanted.map((w) => w.replace(/\s+/g, ''))];
        focusAppInBackground({ processes: procs, titles: ['Jellyfin', ...wanted], timeoutSeconds: launched ? 20 : 8 });
      }
      res.json({ ok: true, launched, client: session.Client, device: session.DeviceName });
    });
  },
};

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad2 = (n) => String(n).padStart(2, '0');

function requireId(v, name) {
  const s = String(v ?? '').trim();
  if (!ID_RE.test(s)) throw httpError(400, `${name} is missing or invalid`);
  return s;
}

/** One "Up Next" entry in the shape the dashboard renders. */
export function toItem(it) {
  const season = it.ParentIndexNumber;
  const ep = it.IndexNumber;
  const code = season != null && ep != null ? `s${pad2(season)}e${pad2(ep)}${it.IndexNumberEnd ? `-e${pad2(it.IndexNumberEnd)}` : ''}` : '';
  const tags = it.ImageTags || {};
  let image = null;
  if (tags.Primary) image = { id: it.Id, type: 'Primary', tag: tags.Primary };
  else if (it.ParentThumbItemId && it.ParentThumbImageTag) image = { id: it.ParentThumbItemId, type: 'Thumb', tag: it.ParentThumbImageTag };
  else if (it.ParentBackdropItemId && it.ParentBackdropImageTags?.[0]) image = { id: it.ParentBackdropItemId, type: 'Backdrop', tag: it.ParentBackdropImageTags[0] };
  else if (it.SeriesId && it.SeriesPrimaryImageTag) image = { id: it.SeriesId, type: 'Primary', tag: it.SeriesPrimaryImageTag };
  return {
    id: it.Id,
    series: it.SeriesName || '',
    code,
    title: it.Name || '',
    image,
    progress: Math.round(Number(it.UserData?.PlayedPercentage) || 0),
    resumeTicks: Number(it.UserData?.PlaybackPositionTicks) || 0,
  };
}

// ---- sessions --------------------------------------------------------------
async function findSession(conn, wantedClients, userId) {
  const sessions = await jf(conn, 'GET', '/Sessions');
  const matches = (Array.isArray(sessions) ? sessions : []).filter((s) => {
    if (!s.SupportsRemoteControl) return false;
    const client = String(s.Client || '').toLowerCase();
    return wantedClients.some((w) => client.includes(w));
  });
  // prefer a session of the same user, then the most recently active one
  matches.sort(
    (a, b) =>
      Number(userId && b.UserId === userId) - Number(userId && a.UserId === userId) ||
      String(b.LastActivityDate || '').localeCompare(String(a.LastActivityDate || ''))
  );
  return matches[0] || null;
}

// ---- connection + HTTP -----------------------------------------------------
const connections = new Map(); // opaque id -> { base, key }

function register(conn) {
  const id = crypto.createHash('sha256').update(`${conn.base}\0${conn.key}`).digest('hex').slice(0, 20);
  connections.delete(id);
  connections.set(id, conn);
  if (connections.size > 20) connections.delete(connections.keys().next().value);
  return id;
}

function connection(body = {}) {
  let raw = String(body.url || process.env.JELLYFIN_URL || '').trim().replace(/\/+$/, '');
  const key = String(body.apiKey || process.env.JELLYFIN_API_KEY || '').trim();
  if (!raw || !key) throw httpError(400, 'Jellyfin URL and API key are not configured');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `http://${raw}`; // "192.168.1.20:8096" is fine
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw httpError(400, 'Jellyfin URL is invalid');
  }
  if (!/^https?:$/.test(url.protocol)) throw httpError(400, 'Jellyfin URL must be http(s)');
  return { base: url.toString().replace(/\/+$/, ''), key };
}

async function jfRaw({ base, key }, path, query = {}, init = {}) {
  const url = new URL(base + path);
  for (const [k, v] of Object.entries(query)) if (v != null) url.searchParams.set(k, String(v));
  try {
    return await resilientFetch(url, {
      ...init,
      headers: {
        Authorization: `MediaBrowser Client="Office Dashboard", Device="Dashboard server", DeviceId="office-dashboard", Version="1.0", Token="${key}"`,
        'X-Emby-Token': key, // older servers
        Accept: 'application/json',
        ...init.headers,
      },
    }, { timeoutMs: 10_000 });
  } catch (err) {
    throw httpError(502, `Cannot reach Jellyfin: ${describeNetError(err.cause || err)}`);
  }
}

async function jf(conn, method, path, query) {
  const r = await jfRaw(conn, path, query, { method });
  if (r.status === 401) throw httpError(502, 'Jellyfin rejected the API key (401)');
  if (r.status === 403) throw httpError(502, 'Jellyfin refused the request (403) - does the API key have access?');
  if (!r.ok) throw httpError(502, `Jellyfin returned ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json().catch(() => ({}));
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  e.expose = true;
  return e;
}
