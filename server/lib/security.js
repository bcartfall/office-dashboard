/**
 * The API can launch programs and call Home Assistant on the user's behalf, so
 * a random website in the same browser must never be able to reach it.
 *
 *  - Host check        -> blocks DNS-rebinding attacks
 *  - Origin check      -> blocks cross-site requests (CSRF) from other pages
 *  - JSON content-type -> forces a CORS preflight for anything that mutates
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function guard({ port }) {
  const extra = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const allowedOrigins = new Set([
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
    'http://localhost:5257', // vite dev server
    'http://127.0.0.1:5257',
    ...extra,
  ]);

  return (req, res, next) => {
    const host = (req.headers.host || '').replace(/:\d+$/, '');
    if (!LOCAL_HOSTS.has(host)) return res.status(403).json({ error: 'Forbidden host' });

    const origin = req.headers.origin;
    if (origin && !allowedOrigins.has(origin)) {
      return res.status(403).json({ error: 'Forbidden origin' });
    }

    if (req.method !== 'GET' && req.method !== 'HEAD' && !req.is('application/json')) {
      return res.status(415).json({ error: 'Content-Type must be application/json' });
    }
    next();
  };
}
