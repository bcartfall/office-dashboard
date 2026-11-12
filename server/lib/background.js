/**
 * Background sampling. A plugin that exports
 *
 *   background: {
 *     interval:  (config) => seconds between runs,
 *     signature: (config) => string; when it changes the recorded history is discarded
 *                (e.g. a different disk volume),
 *     points:    (config) => how many samples to keep (omit for plugins that only warm a cache),
 *     run:       async (config) => number[]   // one value per graph line (omit result to record nothing)
 *   }
 *
 * is run on the server for every instance of it found in the saved layout - whether or not
 * a browser is open. The recorded samples are kept in memory, persisted to disk, and served
 * to the dashboard at GET /api/history/:instanceId so graphs are already filled on page load.
 */
import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, DEV } from './config.js';
import { layoutEvents, readLayout, pluginInstances } from './layout.js';

// Dev and production each write their own file so two running servers never clobber each other.
const FILE = path.join(DATA_DIR, DEV ? 'history.dev.json' : 'history.json');
const FLUSH_MS = 30_000;
const MAX_POINTS = 5000;

/** instanceId -> { type, config, sig, epoch, samples: [{ t, v: number[] }], nextAt, running } */
const tracked = new Map();
let dirty = false;

export const historyRouter = Router();

historyRouter.get('/:id', (req, res) => {
  const entry = tracked.get(req.params.id);
  if (!entry || !entry.def.points) return res.json({ tracked: false, epoch: null, samples: [] });
  const since = Number(req.query.since);
  const samples = Number.isFinite(since) ? entry.samples.filter((s) => s.t > since) : entry.samples;
  // `epoch` changes when history is reset (different volume/GPU, ...); clients then replace what they have.
  res.json({ tracked: true, epoch: entry.epoch, intervalSeconds: entry.interval, samples });
});

export function startBackground(plugins) {
  const defs = new Map(plugins.filter((p) => p.background && typeof p.background.run === 'function').map((p) => [p.id, p.background]));
  if (!defs.size) return;

  const persisted = loadFile();

  function reconcile(layout) {
    const seen = new Set();
    for (const inst of pluginInstances(layout)) {
      const def = defs.get(inst.type);
      if (!def) continue;
      seen.add(inst.id);
      const sig = String(def.signature?.(inst.config) ?? '');
      let entry = tracked.get(inst.id);
      if (!entry) {
        const old = persisted[inst.id];
        const usable = old && old.type === inst.type && old.sig === sig && Array.isArray(old.samples);
        entry = {
          def,
          type: inst.type,
          sig,
          epoch: usable ? old.epoch : newEpoch(),
          samples: usable ? old.samples : [],
          nextAt: 0,
          running: false,
        };
        tracked.set(inst.id, entry);
        console.log(`[background] tracking ${inst.type} ${inst.id.slice(0, 8)}${usable ? ` (restored ${entry.samples.length} samples)` : ''}`);
      } else if (entry.sig !== sig) {
        entry.sig = sig;
        entry.epoch = newEpoch();
        entry.samples = [];
        entry.nextAt = 0;
        dirty = true;
      }
      entry.config = inst.config;
      entry.interval = intervalOf(def, inst.config);
      if (def.points) trim(entry, def.points(inst.config));
    }
    for (const id of [...tracked.keys()]) {
      if (!seen.has(id)) {
        tracked.delete(id);
        dirty = true;
      }
    }
  }

  async function runOne(entry) {
    entry.running = true;
    const startedFor = entry.epoch;
    try {
      const values = await entry.def.run(entry.config);
      // The instance may have been reconfigured or removed while we were waiting.
      if (Array.isArray(values) && entry.def.points && entry.epoch === startedFor) {
        entry.samples.push({ t: Date.now(), v: values.map((n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : 0)) });
        trim(entry, entry.def.points(entry.config));
        dirty = true;
      }
    } catch (err) {
      if (!entry.lastError || entry.lastError !== err.message) console.warn(`[background] ${entry.type}: ${err.message}`);
      entry.lastError = err.message;
    } finally {
      entry.running = false;
      entry.nextAt = Date.now() + entry.interval * 1000;
    }
  }

  const tick = setInterval(() => {
    const now = Date.now();
    for (const entry of tracked.values()) if (!entry.running && now >= entry.nextAt) runOne(entry);
  }, 1000);
  tick.unref();

  const flushTimer = setInterval(flush, FLUSH_MS);
  flushTimer.unref();
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK']) {
    process.once(sig, () => {
      flush();
      process.exit(0);
    });
  }
  process.on('exit', flush);

  layoutEvents.on('change', reconcile);
  readLayout().then((layout) => layout && reconcile(layout));

  function flush() {
    if (!dirty) return;
    dirty = false;
    const out = {};
    for (const [id, e] of tracked) if (e.def.points) out[id] = { type: e.type, sig: e.sig, epoch: e.epoch, samples: e.samples };
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = `${FILE}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ version: 1, instances: out }));
      fs.renameSync(tmp, FILE);
    } catch (err) {
      console.warn(`[background] could not save history: ${err.message}`);
      dirty = true;
    }
  }
}

const newEpoch = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const intervalOf = (def, config) => Math.min(86400, Math.max(1, Math.round(Number(def.interval(config))) || 5));

function trim(entry, points) {
  const cap = Math.min(MAX_POINTS, Math.max(10, Number(points) || 60));
  if (entry.samples.length > cap) entry.samples.splice(0, entry.samples.length - cap);
}

function loadFile() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8')).instances || {};
  } catch {
    return {};
  }
}
