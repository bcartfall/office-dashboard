/**
 * Network client for talking to LAN / cloud services (Jellyfin, Home Assistant, Google, speed tests).
 *
 * Why not plain fetch()? After the computer wakes from sleep the network usually comes back a few seconds
 * *after* the process does. In that window DNS lookups fail ("host not found" / ENOTFOUND, EAI_AGAIN) and
 * pooled keep-alive sockets are dead; Windows also caches a failed lookup for a while, so a LAN host name can
 * keep failing even after the network is back. resilientFetch():
 *
 *  - opens a fresh connection every time (no dead keep-alive sockets to reuse),
 *  - remembers the last address every host name resolved to and falls back to it when DNS fails
 *    (TLS still validates against the host *name*, so https works too),
 *  - retries transient failures a couple of times with a short back-off,
 *  - returns a normal WHATWG Response, so callers use it like fetch().
 */
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';

const TRANSIENT = new Set([
  'ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'ENETDOWN',
  'EPIPE', 'ECONNABORTED', 'EADDRNOTAVAIL', 'ESOCKETTIMEDOUT', 'EAI_FAIL',
]);
const RETRY_DELAYS = [1000, 3000];
const MAX_BODY = 64 * 1024 * 1024;

/** hostname -> { address, family } of the last successful lookup */
const lastKnown = new Map();

function lookup(hostname, options, callback) {
  if (typeof options === 'function') [callback, options] = [options, {}];
  const wantAll = Boolean(options?.all);
  dns.lookup(hostname, options, (err, address, family) => {
    if (!err) {
      const first = wantAll ? address[0] : { address, family };
      if (first) lastKnown.set(hostname, { address: first.address, family: first.family });
      return callback(null, address, family);
    }
    const known = lastKnown.get(hostname);
    if (known && (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN' || err.code === 'EAI_FAIL')) {
      return wantAll ? callback(null, [{ address: known.address, family: known.family }]) : callback(null, known.address, known.family);
    }
    callback(err);
  });
}

function once(url, { method = 'GET', headers = {}, body, timeoutMs, signal }) {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(
      url,
      {
        method,
        headers,
        agent: false, // fresh socket per request
        lookup: net.isIP(url.hostname) ? undefined : lookup,
        signal,
      },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (c) => {
          size += c.length;
          if (size > MAX_BODY) return req.destroy(Object.assign(new Error('Response too large'), { code: 'EMSGSIZE' }));
          chunks.push(c);
        });
        res.on('error', reject);
        res.on('end', () => resolve({ status: res.statusCode || 0, statusText: res.statusMessage || '', headers: res.headers, body: Buffer.concat(chunks) }));
      }
    );
    req.on('error', reject);
    if (timeoutMs) req.setTimeout(timeoutMs, () => req.destroy(Object.assign(new Error('Request timed out'), { code: 'ETIMEDOUT' })));
    if (body != null) req.write(body);
    req.end();
  });
}

function toResponse(r, method) {
  const headers = new Headers();
  for (const [k, v] of Object.entries(r.headers)) for (const item of Array.isArray(v) ? v : [v]) if (item != null) headers.append(k, String(item));
  const empty = method === 'HEAD' || [101, 204, 205, 304].includes(r.status);
  return new Response(empty ? null : r.body, { status: Math.min(599, Math.max(200, r.status)), statusText: r.statusText, headers });
}

const codeOf = (err) => err?.code || err?.cause?.code || (err?.name === 'AbortError' ? 'ETIMEDOUT' : '');

/**
 * fetch()-alike. `init` supports method, headers (plain object), body (string | Buffer | URLSearchParams).
 * opts: { timeoutMs = 10000, retries = 2 }.
 * Rejects with Error('fetch failed') whose `.cause.code` is the system error code, like fetch() does.
 */
export async function resilientFetch(input, init = {}, { timeoutMs = 10_000, retries = RETRY_DELAYS.length } = {}) {
  let url = new URL(input);
  const method = String(init.method || 'GET').toUpperCase();
  const headers = { ...(init.headers instanceof Headers ? Object.fromEntries(init.headers) : init.headers) };
  let body = init.body;
  if (body instanceof URLSearchParams) body = body.toString();
  if (typeof body === 'string') body = Buffer.from(body);
  if (body != null && !Object.keys(headers).some((h) => h.toLowerCase() === 'content-length')) headers['Content-Length'] = String(body.length);

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      let current = url;
      for (let hop = 0; hop < 5; hop++) {
        const r = await once(current, { method, headers, body, timeoutMs });
        const loc = r.headers.location;
        if ([301, 302, 303, 307, 308].includes(r.status) && loc && method === 'GET') {
          current = new URL(loc, current);
          continue;
        }
        return toResponse(r, method);
      }
      throw Object.assign(new Error('Too many redirects'), { code: 'ERR_TOO_MANY_REDIRECTS' });
    } catch (err) {
      lastErr = err;
      const code = codeOf(err);
      const timedOut = code === 'ETIMEDOUT';
      if (!TRANSIENT.has(code) || attempt >= retries || (timedOut && attempt >= 1)) break;
      await new Promise((r) => setTimeout(r, RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)]));
    }
  }
  throw new Error('fetch failed', { cause: lastErr });
}

/** Short human-readable reason for a failed request, e.g. "host not found (DNS)". */
export function describeNetError(err) {
  const code = codeOf(err);
  switch (code) {
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
    case 'EAI_FAIL':
      return 'host not found (DNS) - the network may still be reconnecting';
    case 'ECONNREFUSED':
      return 'connection refused - is the service running?';
    case 'ETIMEDOUT':
      return 'timed out';
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
    case 'ENETDOWN':
      return 'network unreachable';
    case 'ECONNRESET':
      return 'connection reset';
    default:
      return code || err?.message || 'unknown error';
  }
}
