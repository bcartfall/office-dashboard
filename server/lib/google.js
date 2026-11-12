/**
 * Minimal Google OAuth 2.0 + Calendar REST client (no SDK needed).
 *
 * Flow: you create an OAuth client of type "Desktop app" in Google Cloud Console, paste its client
 * id/secret in the Calendar plugin settings (or set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET), click
 * "Connect" and approve read-only access. Only the long-lived *refresh token* is stored (data/google.json,
 * owner-only permissions); access tokens live in memory. Nothing secret is ever sent to the browser.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR, PORT } from './config.js';

const FILE = path.join(DATA_DIR, 'google.json');
const SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
export const API = 'https://www.googleapis.com/calendar/v3';

export const redirectUri = () => `http://127.0.0.1:${PORT}/api/plugins/calendar/oauth/callback`;

// ---- persisted settings ----------------------------------------------------
function readFile() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return {};
  }
}
function patchFile(patch) {
  // Re-read before writing: dev and production servers may both touch this file.
  const next = { ...readFile(), ...patch };
  for (const k of Object.keys(next)) if (next[k] == null) delete next[k];
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, FILE);
}

const client = () => {
  const f = readFile();
  return {
    id: String(process.env.GOOGLE_CLIENT_ID || f.clientId || '').trim(),
    secret: String(process.env.GOOGLE_CLIENT_SECRET || f.clientSecret || '').trim(),
    fromEnv: Boolean(process.env.GOOGLE_CLIENT_ID),
  };
};

export function status() {
  const c = client();
  const f = readFile();
  return {
    configured: Boolean(c.id && c.secret),
    clientFromEnv: c.fromEnv,
    connected: Boolean(f.refreshToken),
    account: f.account || null,
    redirectUri: redirectUri(),
  };
}

export function saveClient(id, secret) {
  id = String(id || '').trim();
  secret = String(secret || '').trim();
  if (!id || !secret) throw httpError(400, 'Client ID and client secret are both required');
  // A different client invalidates any existing refresh token.
  const changed = id !== client().id;
  patchFile({ clientId: id, clientSecret: secret, ...(changed ? { refreshToken: null, account: null } : {}) });
  if (changed) access = null;
}

export async function disconnect() {
  const token = readFile().refreshToken;
  patchFile({ refreshToken: null, account: null });
  access = null;
  if (token) {
    // best effort: also revoke it at Google
    await fetch(REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }),
      signal: AbortSignal.timeout(8000),
    }).catch(() => {});
  }
}

// ---- authorisation (PKCE) --------------------------------------------------
const pending = new Map(); // state -> { verifier, at }
const PENDING_TTL = 10 * 60_000;
const b64url = (buf) => buf.toString('base64url');

export function beginAuth() {
  const c = client();
  if (!c.id || !c.secret) throw httpError(400, 'Save a Google client ID and secret first');
  for (const [k, v] of pending) if (Date.now() - v.at > PENDING_TTL) pending.delete(k);
  const state = b64url(crypto.randomBytes(24));
  const verifier = b64url(crypto.randomBytes(48));
  pending.set(state, { verifier, at: Date.now() });
  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({
    client_id: c.id,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent', // always hand out a refresh token
    include_granted_scopes: 'true',
    state,
    code_challenge: b64url(crypto.createHash('sha256').update(verifier).digest()),
    code_challenge_method: 'S256',
  }).toString();
  return url.toString();
}

export async function finishAuth(code, state) {
  const entry = pending.get(state);
  pending.delete(state);
  if (!entry || Date.now() - entry.at > PENDING_TTL) throw httpError(400, 'This sign-in link has expired or was not started here. Try Connect again.');
  const c = client();
  const tok = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(),
    code_verifier: entry.verifier,
    client_id: c.id,
    client_secret: c.secret,
  });
  if (!tok.refresh_token) throw httpError(502, 'Google did not return a refresh token. Remove the app from your Google account permissions and connect again.');
  patchFile({ refreshToken: tok.refresh_token, account: null });
  access = { token: tok.access_token, expiresAt: Date.now() + (tok.expires_in - 60) * 1000 };
  try {
    const me = await get('/calendars/primary', { fields: 'id' });
    patchFile({ account: me.id });
  } catch {
    /* cosmetic only */
  }
}

// ---- tokens ----------------------------------------------------------------
let access = null; // { token, expiresAt }
let refreshing = null;

async function tokenRequest(params) {
  let r;
  try {
    r = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    throw httpError(502, `Cannot reach Google: ${err.cause?.code || err.message}`);
  }
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = httpError(r.status === 400 || r.status === 401 ? 401 : 502, `Google sign-in failed: ${body.error_description || body.error || r.status}`);
    e.googleError = body.error;
    throw e;
  }
  return body;
}

async function accessToken(force = false) {
  if (!force && access && Date.now() < access.expiresAt) return access.token;
  refreshing ??= (async () => {
    const c = client();
    const refreshToken = readFile().refreshToken;
    if (!refreshToken || !c.id) throw httpError(401, 'Google Calendar is not connected');
    try {
      const tok = await tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: c.id, client_secret: c.secret });
      access = { token: tok.access_token, expiresAt: Date.now() + (tok.expires_in - 60) * 1000 };
      return access.token;
    } catch (err) {
      if (err.googleError === 'invalid_grant') {
        // revoked, or expired (Google expires refresh tokens after 7 days while the OAuth app is in "Testing")
        patchFile({ refreshToken: null, account: null });
        access = null;
        throw httpError(401, 'Google access expired or was revoked - connect again in the calendar settings');
      }
      throw err;
    }
  })().finally(() => (refreshing = null));
  return refreshing;
}

// ---- API -------------------------------------------------------------------
export async function get(pathname, params = {}) {
  const url = new URL(API + pathname);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, String(v));
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await accessToken(attempt > 0);
    let r;
    try {
      r = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
    } catch (err) {
      throw httpError(502, `Cannot reach Google Calendar: ${err.cause?.code || err.message}`);
    }
    if (r.status === 401 && attempt === 0) continue; // token rejected: refresh once and retry
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      const reason = body.error?.message || r.status;
      if (r.status === 403 && /has not been used|disabled/i.test(String(reason))) {
        throw httpError(502, 'The Google Calendar API is not enabled for your Google Cloud project - enable it in the console');
      }
      throw httpError(r.status === 404 ? 404 : 502, `Google Calendar: ${reason}`);
    }
    return r.json();
  }
  throw httpError(401, 'Google Calendar is not connected');
}

export function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  e.expose = true;
  return e;
}
