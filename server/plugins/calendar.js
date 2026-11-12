/**
 * Google Calendar bridge. Each plugin instance lists the Google calendars it wants
 * ({ id, name, color }); the server asks the Calendar API for the requested window and returns one
 * merged list. A calendar that fails doesn't hide the others - it is reported in `errors`.
 *
 *  GET  /status          connection state (never contains secrets)
 *  POST /client          save the OAuth client id + secret
 *  POST /auth/start      -> { url } to open in a browser tab to approve read-only access
 *  GET  /oauth/callback  where Google sends the browser back to
 *  POST /disconnect
 *  GET  /calendars       every calendar on the account (own, shared with you, subscribed)
 *  POST /events          merged events for { calendars, days }
 *
 * The server also refreshes each calendar instance in the background so the first page load is instant.
 */
import * as google from '../lib/google.js';

const MAX_CALENDARS = 30;
const MAX_EVENTS_PER_CALENDAR = 250;
const FRESH_MS = 60_000; // how old a cached answer may be when the browser asks

export default {
  id: 'calendar',
  name: 'Calendar',
  description: 'Upcoming events from your Google calendars',

  // No graph to record - this just keeps the events (and the Google access token) warm.
  background: {
    interval: (config) => Math.max(30, Number(config?.refreshSeconds) || 300),
    signature: () => '',
    run: async (config) => {
      if (!google.status().connected) return;
      const calendars = pickCalendars(config?.calendars);
      if (!calendars.length) return;
      await collect(calendars, clamp(Math.round(Number(config?.daysToShow) || 1), 1, 31), 0);
    },
  },

  routes(router) {
    router.get('/status', (_req, res) => res.json(google.status()));

    router.post('/client', (req, res) => {
      google.saveClient(req.body?.clientId, req.body?.clientSecret);
      res.json(google.status());
    });

    router.post('/auth/start', (_req, res) => res.json({ url: google.beginAuth() }));

    router.get('/oauth/callback', async (req, res) => {
      const page = (title, message) =>
        res
          .status(title === 'Connected' ? 200 : 400)
          .type('html')
          .send(
            `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title><body style="font:16px system-ui;background:#09090b;color:#e4e4e7;display:grid;place-items:center;height:100vh;margin:0"><div style="max-width:30em;text-align:center"><h1 style="font-size:1.4em">${esc(title)}</h1><p style="color:#a1a1aa">${esc(message)}</p></div>`
          );
      if (req.query.error) return page('Not connected', `Google said: ${String(req.query.error)}`);
      try {
        await google.finishAuth(String(req.query.code || ''), String(req.query.state || ''));
        page('Connected', 'Google Calendar is connected. You can close this tab and return to the dashboard.');
      } catch (err) {
        page('Not connected', err.message);
      }
    });

    router.post('/disconnect', async (_req, res) => {
      await google.disconnect();
      store.clear();
      res.json(google.status());
    });

    router.get('/calendars', async (_req, res) => {
      const out = [];
      let pageToken;
      do {
        const r = await google.get('/users/me/calendarList', {
          maxResults: 250,
          minAccessRole: 'freeBusyReader',
          showHidden: false,
          pageToken,
          fields: 'nextPageToken,items(id,summary,summaryOverride,backgroundColor,primary,accessRole)',
        });
        for (const c of r.items || []) {
          out.push({
            id: c.id,
            name: c.summaryOverride || c.summary || c.id,
            color: c.backgroundColor || '#38bdf8',
            primary: Boolean(c.primary),
            accessRole: c.accessRole,
          });
        }
        pageToken = r.nextPageToken;
      } while (pageToken && out.length < 500);
      out.sort((a, b) => Number(b.primary) - Number(a.primary) || a.name.localeCompare(b.name));
      res.json(out);
    });

    router.post('/events', async (req, res) => {
      const st = google.status();
      const days = clamp(Math.round(Number(req.body?.days) || 1), 1, 31);
      const { from, to } = windowOf(days);
      if (!st.connected) return res.json({ connected: false, configured: st.configured, from, to, events: [], errors: [] });
      const calendars = pickCalendars(req.body?.calendars);
      const { events, errors } = await collect(calendars, days, FRESH_MS);
      res.json({ connected: true, configured: true, from, to, events, errors });
    });
  },
};

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const pickCalendars = (list) =>
  (Array.isArray(list) ? list : [])
    .filter((c) => c && typeof c.id === 'string' && c.id && c.enabled !== false)
    .slice(0, MAX_CALENDARS)
    .map((c) => ({ id: c.id, name: String(c.name || '').trim() }));

/** Local midnight today .. end of the last requested day. */
function windowOf(days) {
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setDate(to.getDate() + days);
  return { from: from.toISOString(), to: to.toISOString() };
}

// calendarId + window -> { at, promise }: coalesces concurrent requests and serves recent answers.
const store = new Map();

function fetchCalendar(calendarId, window, maxAgeMs) {
  const key = `${calendarId}|${window.from}|${window.to}`;
  const hit = store.get(key);
  if (hit && Date.now() - hit.at <= maxAgeMs) return hit.promise;
  const promise = listEvents(calendarId, window);
  const entry = { at: Date.now(), promise };
  store.set(key, entry);
  promise.catch(() => store.get(key) === entry && store.delete(key));
  if (store.size > 400) for (const [k, v] of store) if (Date.now() - v.at > 3600_000) store.delete(k);
  return promise;
}

async function collect(calendars, days, maxAgeMs) {
  const window = windowOf(days);
  const events = [];
  const errors = [];
  await Promise.all(
    calendars.map(async (cal) => {
      try {
        for (const ev of await fetchCalendar(cal.id, window, maxAgeMs)) events.push({ ...ev, calendarId: cal.id });
      } catch (err) {
        errors.push({ calendarId: cal.id, name: cal.name || cal.id, message: err.message || String(err) });
      }
    })
  );
  events.sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
  return { events, errors };
}

async function listEvents(calendarId, { from, to }) {
  const out = [];
  let pageToken;
  do {
    const r = await google.get(`/calendars/${encodeURIComponent(calendarId)}/events`, {
      timeMin: from,
      timeMax: to,
      singleEvents: true, // expand recurring events
      orderBy: 'startTime',
      maxResults: 250,
      pageToken,
      fields: 'nextPageToken,items(id,status,summary,location,start,end,attendees(self,responseStatus))',
    });
    for (const e of r.items || []) {
      if (e.status === 'cancelled') continue;
      if ((e.attendees || []).some((a) => a.self && a.responseStatus === 'declined')) continue;
      const ev = toEvent(e);
      if (ev) out.push(ev);
    }
    pageToken = r.nextPageToken;
  } while (pageToken && out.length < MAX_EVENTS_PER_CALENDAR);
  return out;
}

/** Google event -> the shape the dashboard renders. All-day events are calendar dates (end is exclusive). */
function toEvent(e) {
  const title = String(e.summary || '').trim() || '(No title)';
  const location = String(e.location || '').trim();
  if (e.start?.date) {
    const start = new Date(`${e.start.date}T00:00:00`);
    const end = new Date(`${(e.end?.date || e.start.date)}T00:00:00`);
    return {
      title,
      location,
      allDay: true,
      start: start.toISOString(),
      end: end.toISOString(),
      startDay: e.start.date,
      endDay: e.end?.date && e.end.date > e.start.date ? e.end.date : dayAfter(start),
    };
  }
  if (!e.start?.dateTime) return null;
  const start = new Date(e.start.dateTime);
  const end = e.end?.dateTime ? new Date(e.end.dateTime) : start;
  if (Number.isNaN(start.getTime())) return null;
  return { title, location, allDay: false, start: start.toISOString(), end: (end >= start ? end : start).toISOString() };
}

function dayAfter(d) {
  const n = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
}
