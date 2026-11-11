/**
 * Home Assistant bridge. The browser never talks to Home Assistant directly
 * (avoids CORS and keeps the long-lived token out of page requests); instead
 * each plugin instance passes its own url/token, falling back to the
 * HA_URL / HA_TOKEN environment variables.
 */
const SERVICE_RE = /^[a-z0-9_]+\.[a-z0-9_]+$/;
const ENTITY_RE = /^[a-z0-9_]+\.[a-z0-9_]+$/;

export default {
  id: 'home-assistant',
  name: 'Home Assistant',
  description: 'Trigger Home Assistant actions with buttons',
  routes(router) {
    // POST (not GET) so the token never appears in a URL.
    router.post('/states', async (req, res) => {
      const conn = connection(req.body);
      const wanted = Array.isArray(req.body?.entityIds) ? new Set(req.body.entityIds) : null;
      const states = await ha(conn, 'GET', '/api/states');
      const list = states
        .filter((s) => !wanted || wanted.has(s.entity_id))
        .map((s) => ({
          entity_id: s.entity_id,
          state: s.state,
          name: s.attributes?.friendly_name || s.entity_id,
        }));
      res.json(list);
    });

    router.post('/call', async (req, res) => {
      const conn = connection(req.body);
      const { action, entity_id: entityId } = req.body || {};
      if (!SERVICE_RE.test(action || '')) return res.status(400).json({ error: 'action must look like "domain.service"' });
      if (entityId && !ENTITY_RE.test(entityId)) return res.status(400).json({ error: 'Invalid entity_id' });

      let extra = {};
      if (req.body.data) {
        try {
          extra = typeof req.body.data === 'string' ? JSON.parse(req.body.data) : req.body.data;
        } catch {
          return res.status(400).json({ error: 'Extra data is not valid JSON' });
        }
      }
      const [domain, service] = action.split('.');
      const payload = { ...extra, ...(entityId ? { entity_id: entityId } : {}) };
      await ha(conn, 'POST', `/api/services/${domain}/${service}`, payload);
      res.json({ ok: true });
    });
  },
};

function connection(body = {}) {
  const raw = String(body.url || process.env.HA_URL || '').trim().replace(/\/+$/, '');
  const token = String(body.token || process.env.HA_TOKEN || '').trim();
  if (!raw || !token) throw httpError(400, 'Home Assistant URL and token are not configured');
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw httpError(400, 'Home Assistant URL is invalid');
  }
  if (!/^https?:$/.test(url.protocol)) throw httpError(400, 'Home Assistant URL must be http(s)');
  return { base: url.toString().replace(/\/+$/, ''), token };
}

async function ha({ base, token }, method, path, body) {
  let r;
  try {
    r = await fetch(base + path, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    throw httpError(502, `Cannot reach Home Assistant: ${err.cause?.code || err.message}`);
  }
  if (r.status === 401) throw httpError(502, 'Home Assistant rejected the token (401)');
  if (!r.ok) throw httpError(502, `Home Assistant returned ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json().catch(() => ({}));
}

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  e.expose = true;
  return e;
}
