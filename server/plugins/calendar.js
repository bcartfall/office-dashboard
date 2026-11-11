/**
 * Calendar bridge. Each plugin instance sends a list of ICS feeds
 * ({ id, name, url, color }); the server downloads them (the browser can't, because
 * of CORS), expands recurring events and returns one merged list for the requested
 * window. A feed that fails doesn't hide the others - it is reported in `errors`.
 *
 * POST rather than GET so private ICS URLs (which often embed a secret) stay out
 * of URLs and access logs.
 */
import ical from 'node-ical';
import { cached } from '../lib/cache.js';

const MAX_FEEDS = 20;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_EVENTS_PER_FEED = 500;
const FEED_TTL_MS = 60_000;

export default {
  id: 'calendar',
  name: 'Calendar',
  description: 'Upcoming events from one or more ICS calendar feeds',
  routes(router) {
    router.post('/events', async (req, res) => {
      const feeds = (Array.isArray(req.body?.calendars) ? req.body.calendars : [])
        .filter((c) => c && String(c.url || '').trim())
        .slice(0, MAX_FEEDS);
      const days = clamp(Math.round(Number(req.body?.days) || 1), 1, 31);

      const from = new Date();
      from.setHours(0, 0, 0, 0);
      const to = new Date(from);
      to.setDate(to.getDate() + days);
      to.setMilliseconds(-1);

      const events = [];
      const errors = [];
      await Promise.all(
        feeds.map(async (feed) => {
          const label = String(feed.name || '').trim() || hostOf(feed.url);
          try {
            const text = await cached(`ics:${feed.url}`, FEED_TTL_MS, () => download(feed.url));
            for (const ev of expand(text, from, to)) events.push({ ...ev, calendarId: String(feed.id ?? feed.url) });
          } catch (err) {
            errors.push({ calendarId: String(feed.id ?? feed.url), name: label, message: err.message || String(err) });
          }
        })
      );

      events.sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
      res.json({ from: from.toISOString(), to: to.toISOString(), events, errors });
    });
  },
};

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function hostOf(url) {
  try {
    return new URL(normalizeUrl(url)).hostname;
  } catch {
    return 'calendar';
  }
}

/** webcal(s):// is just http(s) with a different label. */
function normalizeUrl(raw) {
  return String(raw).trim().replace(/^webcals?:\/\//i, (m) => (m.toLowerCase() === 'webcals://' ? 'https://' : 'http://'));
}

async function download(raw) {
  let url;
  try {
    url = new URL(normalizeUrl(raw));
  } catch {
    throw httpError(400, 'Not a valid URL');
  }
  if (!/^https?:$/.test(url.protocol)) throw httpError(400, 'Calendar URL must be http(s) or webcal');

  let r;
  try {
    r = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { Accept: 'text/calendar, */*' } });
  } catch (err) {
    throw httpError(502, `Cannot reach calendar: ${err.cause?.code || err.message}`);
  }
  if (!r.ok) throw httpError(502, `Calendar server returned ${r.status}`);
  const text = await r.text();
  if (text.length > MAX_BYTES) throw httpError(502, 'Calendar file is too large');
  if (!/BEGIN:VCALENDAR/i.test(text)) throw httpError(502, 'That URL did not return an ICS calendar');
  return text;
}

function expand(text, from, to) {
  const parsed = ical.parseICS(text);
  const out = [];
  for (const item of Object.values(parsed)) {
    if (item.type !== 'VEVENT' || !item.start) continue;
    if (String(item.status || '').toUpperCase() === 'CANCELLED') continue;

    let instances;
    try {
      instances = ical.expandRecurringEvent(item, { from, to, expandOngoing: true });
    } catch {
      continue; // one malformed recurrence rule shouldn't break the whole feed
    }
    for (const inst of instances) {
      if (String(inst.event?.status || '').toUpperCase() === 'CANCELLED') continue;
      const allDay = Boolean(inst.isFullDay);
      const start = inst.start;
      const end = inst.end && inst.end >= start ? inst.end : start;
      out.push({
        title: textOf(inst.summary) || '(No title)',
        location: textOf(inst.event?.location) || '',
        allDay,
        start: start.toISOString(),
        end: end.toISOString(),
        // All-day events are calendar dates, not instants: send them as such (end is exclusive).
        ...(allDay ? { startDay: dayKey(start), endDay: dayKey(end > start ? end : addDay(start)) } : {}),
      });
      if (out.length >= MAX_EVENTS_PER_FEED) return out;
    }
  }
  return out;
}

// node-ical may return { val, params } for properties that carry parameters.
const textOf = (v) => String(v && typeof v === 'object' && 'val' in v ? v.val : v ?? '').trim();

const addDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  e.expose = true;
  return e;
}
