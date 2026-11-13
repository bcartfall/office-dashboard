/**
 * Network speed, with the local network (LAN) and the Internet reported separately.
 *
 *  LAN       the default adapter's negotiated link speed, its live send/receive throughput and the round-trip
 *            time to the default gateway (your router). Nothing is downloaded: it is all local counters.
 *  Internet  a real speed test: it downloads and uploads a few MB against a speed-test server and measures
 *            the throughput, plus the round-trip time to a public host. It runs in the background on the
 *            server every `testMinutes` (the result is kept as graph history), so it costs a little data on
 *            each run; set a long interval, or 0 to turn the test off.
 *
 * Environment overrides: SPEEDTEST_DOWN_URL (must accept ?bytes=N), SPEEDTEST_UP_URL (accepts a POST body),
 * SPEEDTEST_PING_HOST (host:port for the latency probe).
 */
import net from 'node:net';
import si from 'systeminformation';
import { cached } from '../lib/cache.js';
import { resilientFetch, describeNetError } from '../lib/net.js';
import { keepPoints } from '../lib/bg-config.js';

const DOWN_URL = process.env.SPEEDTEST_DOWN_URL || 'https://speed.cloudflare.com/__down';
const UP_URL = process.env.SPEEDTEST_UP_URL || 'https://speed.cloudflare.com/__up';
const PING_TARGET = process.env.SPEEDTEST_PING_HOST || '1.1.1.1:443';

const DOWN_BYTES = 12 * 1024 * 1024;
const UP_BYTES = 4 * 1024 * 1024;

const testIntervalSeconds = (config) => {
  const minutes = Number(config?.testMinutes);
  return Number.isFinite(minutes) && minutes > 0 ? Math.min(1440, Math.max(5, minutes)) * 60 : 1800;
};

// ---- Internet test ---------------------------------------------------------
/** Result of the last speed test (shared by every plugin instance - the machine has one connection). */
const internet = { downMbps: null, upMbps: null, testedAt: null, testing: false, error: null };
let running = null;

const mbps = (bytes, ms) => (ms > 0 ? (bytes * 8) / 1e6 / (ms / 1000) : 0);

async function measureDown() {
  const t0 = performance.now();
  const r = await resilientFetch(`${DOWN_URL}?bytes=${DOWN_BYTES}`, {}, { timeoutMs: 20_000, retries: 1 });
  if (!r.ok) throw new Error(`download test returned ${r.status}`);
  const bytes = (await r.arrayBuffer()).byteLength;
  return mbps(bytes, performance.now() - t0);
}

async function measureUp() {
  const body = Buffer.alloc(UP_BYTES, 0x61);
  const t0 = performance.now();
  const r = await resilientFetch(UP_URL, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body }, { timeoutMs: 20_000, retries: 1 });
  if (!r.ok) throw new Error(`upload test returned ${r.status}`);
  await r.arrayBuffer().catch(() => {});
  return mbps(body.length, performance.now() - t0);
}

/** Run one Internet test (joins the one in flight, if any). Never throws; failures land in internet.error. */
export function runInternetTest() {
  running ??= (async () => {
    internet.testing = true;
    try {
      const down = await measureDown();
      const up = await measureUp().catch(() => null); // a failed upload test shouldn't discard the download result
      Object.assign(internet, { downMbps: down, upMbps: up, testedAt: Date.now(), error: null });
    } catch (err) {
      internet.error = `Speed test failed: ${describeNetError(err.cause || err)}`;
    } finally {
      internet.testing = false;
      running = null;
    }
  })();
  return running;
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

// ---- LAN -------------------------------------------------------------------
async function readLan() {
  const defaultIface = await cached('net:iface', 30_000, () => si.networkInterfaceDefault().catch(() => ''));
  const [ifaces, gateway, stats] = await Promise.all([
    cached('net:ifaces', 30_000, () => si.networkInterfaces().catch(() => [])),
    cached('net:gateway', 30_000, () => si.networkGatewayDefault().catch(() => '')),
    cached('net:stats', 900, () => si.networkStats(defaultIface || '*').catch(() => [])),
  ]);
  const info = (Array.isArray(ifaces) ? ifaces : [ifaces]).find((i) => i.iface === defaultIface) || null;
  const s = Array.isArray(stats) ? stats[0] : null;
  const latency = gateway ? await cached(`net:gw:${gateway}`, 4000, () => tcpRtt(gateway, 80)) : null;
  return {
    iface: info?.ifaceName || defaultIface || null,
    kind: info?.type || null, // wired | wireless
    linkMbps: info?.speed > 0 ? info.speed : null,
    gateway: gateway || null,
    latencyMs: latency,
    // null until systeminformation has a previous sample to take the difference to
    rxBytesPerSec: s?.rx_sec != null ? Math.max(0, s.rx_sec) : null,
    txBytesPerSec: s?.tx_sec != null ? Math.max(0, s.tx_sec) : null,
  };
}

async function read() {
  const [lan, latency] = await Promise.all([readLan(), cached('net:ping', 4000, () => tcpRtt(pingHost, pingPort))]);
  return {
    lan,
    internet: { ...internet, latencyMs: latency },
  };
}

si.networkStats().catch(() => {}); // prime the per-second counters so the first poll has numbers

export default {
  id: 'network',
  name: 'Network Speed',
  description: 'LAN link speed and traffic, plus a periodic Internet speed test',
  // The Internet test runs on the server on a schedule; its results (down, up in Mbit/s) are the graph history.
  background: {
    interval: testIntervalSeconds,
    points: keepPoints,
    signature: () => '',
    run: async (config) => {
      if (!(Number(config?.testMinutes) > 0)) return undefined; // 0 = test disabled
      await runInternetTest();
      return internet.downMbps == null ? undefined : [internet.downMbps, internet.upMbps ?? 0];
    },
  },
  routes(router) {
    router.get('/data', async (_req, res) => res.json(await read()));
  },
};
