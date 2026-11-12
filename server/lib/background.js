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
 * a browser is open. The recorded samples are stored in a SQLite database (data/history.db, or
 * data/history.dev.db in development) and served to the dashboard at GET /api/history/:instanceId
 * so graphs are already filled on page load.
 */
import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite'; // built into Node 22.13+, no native add-on to compile
import { DATA_DIR, DEV } from './config.js';
import { layoutEvents, readLayout, pluginInstances } from './layout.js';

// Dev and production each use their own database so two running servers never clobber each other.
const DB_FILE = path.join(DATA_DIR, DEV ? 'history.dev.db' : 'history.db');
// Older versions kept history in a JSON file; it is imported once into an empty database.
const MAX_POINTS = 5000;

/** instanceId -> { def, type, config, sig, epoch, interval, nextAt, running } (samples live in SQLite) */
const tracked = new Map();

let db = null;
let q = null;

function openDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(DB_FILE);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS instances (
      id    TEXT PRIMARY KEY,
      type  TEXT NOT NULL,
      sig   TEXT NOT NULL,
      epoch TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS samples (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_id TEXT NOT NULL REFERENCES instances(id) ON DELETE CASCADE,
      t           INTEGER NOT NULL,  -- ms since epoch
      v           TEXT NOT NULL      -- JSON array, one number per graph line
    );
    CREATE INDEX IF NOT EXISTS samples_instance_t ON samples (instance_id, t);
  `);
  q = {
    getInstance: db.prepare('SELECT type, sig, epoch FROM instances WHERE id = ?'),
    upsertInstance: db.prepare(
      'INSERT INTO instances (id, type, sig, epoch) VALUES (@id, @type, @sig, @epoch) ' +
        'ON CONFLICT(id) DO UPDATE SET type = excluded.type, sig = excluded.sig, epoch = excluded.epoch'
    ),
    allIds: db.prepare('SELECT id FROM instances'),
    countInstances: db.prepare('SELECT COUNT(*) AS n FROM instances'),
    deleteInstance: db.prepare('DELETE FROM instances WHERE id = ?'),
    clearSamples: db.prepare('DELETE FROM samples WHERE instance_id = ?'),
    countSamples: db.prepare('SELECT COUNT(*) AS n FROM samples WHERE instance_id = ?'),
    addSample: db.prepare('INSERT INTO samples (instance_id, t, v) VALUES (?, ?, ?)'),
    trim: db.prepare(
      'DELETE FROM samples WHERE instance_id = @id AND id <= ' +
        '(SELECT id FROM samples WHERE instance_id = @id ORDER BY id DESC LIMIT 1 OFFSET @cap)'
    ),
    all: db.prepare('SELECT t, v FROM samples WHERE instance_id = ? ORDER BY id'),
    since: db.prepare('SELECT t, v FROM samples WHERE instance_id = ? AND t > ? ORDER BY id'),
  };
}

const parse = (rows) => rows.map((r) => ({ t: r.t, v: JSON.parse(r.v) }));

export const historyRouter = Router();

historyRouter.get('/:id', (req, res) => {
  const entry = tracked.get(req.params.id);
  if (!entry || !entry.def.points) return res.json({ tracked: false, epoch: null, samples: [] });
  const since = req.query.since === undefined ? NaN : Number(req.query.since);
  const rows = Number.isFinite(since) ? q.since.all(req.params.id, since) : q.all.all(req.params.id);
  const samples = parse(rows);
  // `epoch` changes when history is reset (different volume/GPU, ...); clients then replace what they have.
  res.json({ tracked: true, epoch: entry.epoch, intervalSeconds: entry.interval, samples });
});

export function startBackground(plugins) {
  const defs = new Map(plugins.filter((p) => p.background && typeof p.background.run === 'function').map((p) => [p.id, p.background]));
  if (!defs.size) return;

  try {
    openDb();
  } catch (err) {
    console.error(`[background] could not open ${DB_FILE}: ${err.message}. Graph history is disabled.`);
    return;
  }

  function reconcile(layout) {
    const seen = new Set();
    for (const inst of pluginInstances(layout)) {
      const def = defs.get(inst.type);
      if (!def) continue;
      seen.add(inst.id);
      const sig = String(def.signature?.(inst.config) ?? '');
      let entry = tracked.get(inst.id);
      if (!entry) {
        const old = q.getInstance.get(inst.id);
        const usable = old && old.type === inst.type && old.sig === sig;
        entry = { id: inst.id, def, type: inst.type, sig, epoch: usable ? old.epoch : newEpoch(), nextAt: 0, running: false };
        if (!usable) resetStored(inst.id, entry);
        tracked.set(inst.id, entry);
        const n = usable ? q.countSamples.get(inst.id).n : 0;
        console.log(`[background] tracking ${inst.type} ${inst.id.slice(0, 8)}${usable ? ` (restored ${n} samples)` : ''}`);
      } else if (entry.sig !== sig) {
        entry.sig = sig;
        entry.epoch = newEpoch();
        entry.nextAt = 0;
        resetStored(inst.id, entry);
      }
      entry.config = inst.config;
      entry.interval = intervalOf(def, inst.config);
      if (def.points) trim(inst.id, def.points(inst.config));
    }
    for (const id of [...tracked.keys()]) {
      if (!seen.has(id)) {
        tracked.delete(id);
        q.deleteInstance.run(id); // cascades to its samples
      }
    }
    // Instances left over from a previous run that are no longer in the layout.
    for (const { id } of q.allIds.all()) if (!seen.has(id)) q.deleteInstance.run(id);
  }

  /** Start a fresh history for an instance (new or changed signature). */
  function resetStored(id, entry) {
    db.exec('BEGIN');
    try {
      q.upsertInstance.run({ id, type: entry.type, sig: entry.sig, epoch: entry.epoch });
      q.clearSamples.run(id);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  async function runOne(entry) {
    entry.running = true;
    const startedFor = entry.epoch;
    const { id } = entry;
    try {
      const values = await entry.def.run(entry.config);
      // The instance may have been reconfigured or removed while we were waiting.
      if (tracked.get(id) === entry && Array.isArray(values) && entry.def.points && entry.epoch === startedFor) {
        const v = values.map((n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : 0));
        q.addSample.run(id, Date.now(), JSON.stringify(v));
        trim(id, entry.def.points(entry.config));
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

  for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK']) {
    process.once(sig, () => {
      close();
      process.exit(0);
    });
  }
  process.on('exit', close);

  layoutEvents.on('change', reconcile);
  readLayout().then((layout) => layout && reconcile(layout));

  function close() {
    try {
      db?.close();
    } catch {}
  }
}

const newEpoch = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const intervalOf = (def, config) => Math.min(86400, Math.max(1, Math.round(Number(def.interval(config))) || 5));

function trim(id, points) {
  const cap = Math.min(MAX_POINTS, Math.max(10, Number(points) || 60));
  q.trim.run({ id, cap });
}
