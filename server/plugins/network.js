/**
 * Network speed, with the local network (LAN) and the Internet reported separately.
 *
 *  LAN       the chosen network adapter (setting "Network device", default = the system's default adapter):
 *            negotiated link speed, live upload/download throughput - graphed from server-side history, so the
 *            graph is full when the page opens - and the round-trip time to the default gateway (your router).
 *            Nothing is downloaded: it is all local counters.
 *  Internet  a real speed test: it downloads and uploads a few MB against a speed-test server and measures
 *            the throughput, plus the round-trip time to a public host. It runs in the background on the
 *            server every `testMinutes` and costs a little data on each run (set 0 to turn it off). The first
 *            test starts as soon as a Network plugin exists (or a page asks and none has run yet), not after a
 *            full interval; results are kept in data/network-speedtest.json so a restart doesn't lose them.
 *
 * Environment overrides: SPEEDTEST_DOWN_URL (must accept ?bytes=N), SPEEDTEST_UP_URL (accepts a POST body),
 * SPEEDTEST_PING_HOST (host:port for the latency probe).
 */
import net from 'node:net';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import si from 'systeminformation';
import { cached } from '../lib/cache.js';
import { resilientFetch, describeNetError } from '../lib/net.js';
import { DATA_DIR, DEV } from '../lib/config.js';

const PING_TARGET = process.env.SPEEDTEST_PING_HOST || '1.1.1.1:443';

// Speed-test servers, tried in order (the one that worked last time goes first). Some servers refuse requests that
// don't look like a browser (HTTP 403), so every request carries a browser-style User-Agent.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const PROVIDERS = [
  ...(process.env.SPEEDTEST_DOWN_URL
    ? [{ name: 'custom', down: (n) => `${process.env.SPEEDTEST_DOWN_URL}?bytes=${n}`, up: process.env.SPEEDTEST_UP_URL || null, headers: {} }]
    : []),
  {
    name: 'Cloudflare',
    down: (n) => `https://speed.cloudflare.com/__down?bytes=${n}`,
    up: 'https://speed.cloudflare.com/__up',
    headers: { Origin: 'https://speed.cloudflare.com', Referer: 'https://speed.cloudflare.com/' },
  },
  { name: 'OVH', down: () => 'https://proof.ovh.net/files/100Mb.dat', up: null, headers: {}, maxBytes: 12 * 1024 * 1024 },
  { name: 'Tele2', down: () => 'http://speedtest.tele2.net/10MB.zip', up: 'http://speedtest.tele2.net/upload.php', headers: {} },
];
let preferred = 0; // index of the provider that worked last

const DOWN_BYTES = 12 * 1024 * 1024;
const UP_BYTES = 4 * 1024 * 1024;
const KEEP_RESULTS = 96;
const RETRY_AFTER_FAILURE_MS = 60_000;
const STORE = path.join(DATA_DIR, DEV ? 'network-speedtest.dev.json' : 'network-speedtest.json');

// ---- Internet test ---------------------------------------------------------
/** Shared by every plugin instance - the machine has one connection. `history`: [{ t, down, up }] oldest first. */
const internet = { downMbps: null, upMbps: null, testedAt: null, testing: false, error: null, history: [] };
let running = null;
let lastAttemptAt = 0;

try {
  const saved = JSON.parse(fs.readFileSync(STORE, 'utf8'));
  if (Array.isArray(saved)) {
    internet.history = saved.filter((r) => r && Number.isFinite(r.t) && Number.isFinite(r.down)).slice(-KEEP_RESULTS);
    const last = internet.history.at(-1);
    if (last) Object.assign(internet, { downMbps: last.down, upMbps: last.up ?? null, testedAt: last.t });
  }
} catch {
  /* first run */
}
function persist() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STORE, JSON.stringify(internet.history));
  } catch (err) {
    console.warn(`[network] could not save speed test results: ${err.message}`);
  }
}

const mbps = (bytes, ms) => (ms > 0 ? (bytes * 8) / 1e6 / (ms / 1000) : 0);

const hostOf = (u) => new URL(u).host;
const hdr = (p, extra = {}) => ({ 'User-Agent': UA, Accept: '*/*', ...p.headers, ...extra });

async function measureDown(p) {
  const t0 = performance.now();
  const url = p.down(DOWN_BYTES);
  const r = await resilientFetch(url, { headers: hdr(p) }, { timeoutMs: 20_000, retries: 1 });
  if (!r.ok) throw new Error(`download test returned ${r.status} (${hostOf(url)})`);
  const bytes = (await r.arrayBuffer()).byteLength;
  if (!bytes) throw new Error(`download test returned no data (${hostOf(url)})`);
  return mbps(bytes, performance.now() - t0);
}

async function measureUp(p) {
  if (!p.up) throw new Error('no upload endpoint');
  const body = Buffer.alloc(UP_BYTES, 0x61);
  const t0 = performance.now();
  const r = await resilientFetch(p.up, { method: 'POST', headers: hdr(p, { 'Content-Type': 'application/octet-stream' }), body }, { timeoutMs: 20_000, retries: 1 });
  if (!r.ok) throw new Error(`upload test returned ${r.status} (${hostOf(p.up)})`);
  await r.arrayBuffer().catch(() => {});
  return mbps(body.length, performance.now() - t0);
}

/** Download with the first server that answers; upload with that one, else with any other that has an upload endpoint. */
async function measureAll() {
  const order = PROVIDERS.map((_, i) => i).sort((a, b) => (a === preferred ? -1 : b === preferred ? 1 : a - b));
  let down = null;
  let used = null;
  let lastErr;
  for (const i of order) {
    try {
      down = await measureDown(PROVIDERS[i]);
      used = i;
      break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (down == null) throw lastErr;
  preferred = used;
  let up = null;
  for (const i of [used, ...order.filter((i) => i !== used)]) {
    try {
      up = await measureUp(PROVIDERS[i]);
      break;
    } catch {
      /* try the next one; a missing upload figure doesn't discard the download result */
    }
  }
  return { down, up };
}

/** Run one Internet test (joins the one in flight, if any). Never throws; failures land in internet.error. */
export function runInternetTest() {
  running ??= (async () => {
    internet.testing = true;
    lastAttemptAt = Date.now();
    try {
      const { down, up } = await measureAll();
      const t = Date.now();
      Object.assign(internet, { downMbps: down, upMbps: up, testedAt: t, error: null });
      internet.history.push({ t, down: Math.round(down * 10) / 10, up: up == null ? null : Math.round(up * 10) / 10 });
      if (internet.history.length > KEEP_RESULTS) internet.history.splice(0, internet.history.length - KEEP_RESULTS);
      persist();
    } catch (err) {
      internet.error = `Speed test failed: ${err.cause ? describeNetError(err.cause) : err.message}`;
    } finally {
      internet.testing = false;
      running = null;
    }
  })();
  return running;
}

/**
 * Start a test when one is due: never run, or the last one is older than `minutes`. A failed attempt is retried
 * after a minute (not on every poll). `minutes` <= 0 means the test is switched off.
 */
function testIfDue(minutes) {
  minutes = Number(minutes);
  if (!(minutes > 0) || internet.testing) return;
  const now = Date.now();
  const due = internet.testedAt == null || now - internet.testedAt >= Math.max(5, minutes) * 60_000;
  if (due && now - lastAttemptAt >= RETRY_AFTER_FAILURE_MS) runInternetTest();
}

// ---- latency ---------------------------------------------------------------
/**
 * Round-trip time to host:port via a TCP connect. A refused connection still proves the host answered, so it
 * counts (a router usually refuses unknown ports instantly). Resolves null when nothing answered.
 */
function tcpRtt(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const sock = net.connect({ host, port });
    const done = (ok) => {
      sock.destroy();
      resolve(ok ? Math.round((performance.now() - t0) * 10) / 10 : null);
    };
    sock.setTimeout(timeoutMs, () => done(false));
    sock.once('connect', () => done(true));
    sock.once('error', (err) => done(err.code === 'ECONNREFUSED'));
  });
}

const [pingHost, pingPort] = (() => {
  const m = /^(.*):(\d+)$/.exec(PING_TARGET);
  return m ? [m[1], Number(m[2])] : [PING_TARGET, 443];
})();

// ---- adapters --------------------------------------------------------------
const defaultIface = () => cached('net:default', 30_000, () => si.networkInterfaceDefault().catch(() => ''));
const allIfaces = async () => {
  const list = await cached('net:ifaces', 30_000, () => si.networkInterfaces().catch(() => []));
  return Array.isArray(list) ? list : [list];
};

/** Name of the adapter to measure: the configured one, else the system default. */
async function resolveIface(wanted) {
  return String(wanted || '').trim() || (await defaultIface());
}

/** Live send/receive rate of one adapter in bytes/s (null until two samples exist). */
async function ifaceRates(name) {
  const stats = await cached(`net:stats:${name}`, 900, () => si.networkStats(name || '*').catch(() => []));
  const s = Array.isArray(stats) ? stats[0] : null;
  return {
    rx: s?.rx_sec != null ? Math.max(0, s.rx_sec) : null,
    tx: s?.tx_sec != null ? Math.max(0, s.tx_sec) : null,
    up: s ? s.operstate !== 'down' : null,
  };
}

// Windows: link speed and gateway straight from the adapter (systeminformation often reports neither there).
// The adapter name goes in through an environment variable, never into the script text.
const WIN_SCRIPT = [
  '$a = Get-NetAdapter -Name $env:NET_IFACE -ErrorAction SilentlyContinue | Select-Object -First 1',
  "$r = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -InterfaceAlias $env:NET_IFACE -ErrorAction SilentlyContinue | Sort-Object RouteMetric | Select-Object -First 1",
  '[pscustomobject]@{ speed = [double]$a.ReceiveLinkSpeed; text = "$($a.LinkSpeed)"; gateway = "$($r.NextHop)" } | ConvertTo-Json -Compress',
].join('; ');

function winAdapter(name) {
  return cached(`net:win:${name}`, 30_000, () =>
    new Promise((resolve) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', WIN_SCRIPT],
        { env: { ...process.env, NET_IFACE: name }, timeout: 10_000, windowsHide: true },
        (err, stdout) => {
          if (err) return resolve(null);
          try {
            const j = JSON.parse(String(stdout).trim());
            let mbps = j.speed > 0 ? j.speed / 1e6 : 0;
            if (!mbps) {
              const m = /([\d.]+)\s*([kmgt])bps/i.exec(j.text || ''); // "2.5 Gbps"
              if (m) mbps = Number(m[1]) * { k: 0.001, m: 1, g: 1000, t: 1e6 }[m[2].toLowerCase()];
            }
            resolve({ linkMbps: mbps > 0 ? Math.round(mbps * 10) / 10 : null, gateway: j.gateway && j.gateway !== '0.0.0.0' ? j.gateway : '' });
          } catch {
            resolve(null);
          }
        }
      );
    })
  );
}

async function readLan(wanted) {
  const name = await resolveIface(wanted);
  const isDefault = name === (await defaultIface());
  const [ifaces, rates, gateway] = await Promise.all([
    allIfaces(),
    ifaceRates(name),
    isDefault ? cached('net:gateway', 30_000, () => si.networkGatewayDefault().catch(() => '')) : '',
  ]);
  const info = ifaces.find((i) => i.iface === name) || null;
  let linkMbps = info?.speed > 0 ? info.speed : null;
  let gw = gateway;
  if (process.platform === 'win32' && name) {
    const w = await winAdapter(name);
    if (w?.linkMbps) linkMbps = w.linkMbps;
    if (w?.gateway) gw = w.gateway;
  }
  const latency = gw ? await cached(`net:gw:${gw}`, 4000, () => tcpRtt(gw, 80)) : null;
  return {
    iface: name || null,
    description: info?.ifaceName || null,
    kind: info?.type || null, // wired | wireless
    linkMbps,
    found: Boolean(info) || !wanted,
    up: rates.up,
    gateway: gw || null,
    latencyMs: latency,
    rxBytesPerSec: rates.rx, // null until systeminformation has a previous sample to take the difference to
    txBytesPerSec: rates.tx,
  };
}

si.networkStats().catch(() => {}); // prime the per-second counters so the first poll has numbers

export default {
  id: 'network',
  name: 'Network Speed',
  description: 'Adapter upload/download graph and link speed, plus a periodic Internet speed test',
  // The server samples the chosen adapter around the clock (graph history) and runs the Internet test when due.
  background: {
    interval: (config) => Number(config?.intervalSeconds) || 3,
    points: (config) => Number(config?.historyPoints) || 90,
    signature: (config) => String(config?.iface || ''), // another adapter = a different graph
    run: async (config) => {
      testIfDue(config?.testMinutes);
      const r = await ifaceRates(await resolveIface(config?.iface));
      return r.rx == null ? undefined : [r.rx, r.tx ?? 0];
    },
  },
  routes(router) {
    // Fills the "Network device" picker, e.g. { iface: 'Ethernet', description: 'Realtek PCIe 2.5GbE Family Controller' }.
    router.get('/interfaces', async (_req, res) => {
      const [list, def] = await Promise.all([allIfaces(), defaultIface()]);
      res.json(
        list
          .filter((i) => i.iface && !i.internal)
          .map((i) => ({ iface: i.iface, description: i.ifaceName || '', kind: i.type || '', linkMbps: i.speed > 0 ? i.speed : null, default: i.iface === def }))
          .sort((a, b) => Number(b.default) - Number(a.default) || a.iface.localeCompare(b.iface))
      );
    });

    router.get('/data', async (req, res) => {
      // A page that asks while no test has ever run starts one now (the instance may be too new for the background run).
      testIfDue(req.query.test);
      const [lan, latency] = await Promise.all([
        readLan(typeof req.query.iface === 'string' ? req.query.iface : ''),
        cached('net:ping', 4000, () => tcpRtt(pingHost, pingPort)),
      ]);
      res.json({ lan, internet: { ...internet, latencyMs: latency } });
    });
  },
};
