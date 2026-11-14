/**
 * Todo history. The tasks themselves live in each plugin instance's config (saved with the layout); this keeps a
 * permanent record of every task in SQLite (data/todo.db, or data/todo.dev.db in development): when it was created,
 * when it was completed, and its latest label.
 *
 *  POST /sync     { instanceId, items: [{ id, text, done, created?, completedAt? }] }
 *                 The page sends its current list whenever it changes; the server works out what is new,
 *                 edited, completed (or un-completed) and gone. A snapshot - rather than one call per action - means
 *                 a missed request (server down for a moment) is simply caught up by the next one.
 *  GET  /history  ?instanceId&page&pageSize&filter=all|completed
 *                 newest completed first; tasks that are not completed follow, newest created first.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR, DEV } from '../lib/config.js';

const DB_FILE = path.join(DATA_DIR, DEV ? 'todo.dev.db' : 'todo.db');
const MAX_ITEMS = 2000;
const MAX_TEXT = 500;

let db = null;
let q = null;
function open() {
  if (db) return;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(DB_FILE);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS tasks (
      instance_id  TEXT NOT NULL,
      task_id      TEXT NOT NULL,
      text         TEXT NOT NULL,
      created_at   INTEGER NOT NULL,  -- ms since epoch
      completed_at INTEGER,           -- NULL while open
      removed_at   INTEGER,           -- set when it left the list without being completed (deleted)
      PRIMARY KEY (instance_id, task_id)
    );
    CREATE INDEX IF NOT EXISTS tasks_history ON tasks (instance_id, completed_at DESC, created_at DESC);
  `);
  q = {
    all: db.prepare('SELECT task_id, text, completed_at, removed_at FROM tasks WHERE instance_id = ?'),
    insert: db.prepare('INSERT INTO tasks (instance_id, task_id, text, created_at, completed_at) VALUES (?, ?, ?, ?, ?)'),
    update: db.prepare('UPDATE tasks SET text = ?, completed_at = ?, removed_at = NULL WHERE instance_id = ? AND task_id = ?'),
    remove: db.prepare('UPDATE tasks SET removed_at = ? WHERE instance_id = ? AND task_id = ? AND removed_at IS NULL'),
  };
}

const ts = (v, fallback) => (Number.isFinite(Number(v)) && Number(v) > 0 && Number(v) <= Date.now() + 60_000 ? Math.round(Number(v)) : fallback);

function sync(instanceId, items) {
  open();
  const now = Date.now();
  const known = new Map(q.all.all(instanceId).map((r) => [r.task_id, r]));
  const present = new Set();
  db.exec('BEGIN');
  try {
    for (const it of items.slice(0, MAX_ITEMS)) {
      const id = String(it?.id ?? '').slice(0, 64);
      if (!id) continue;
      present.add(id);
      const text = String(it.text ?? '').slice(0, MAX_TEXT);
      const done = Boolean(it.done);
      const row = known.get(id);
      if (!row) {
        q.insert.run(instanceId, id, text, ts(it.created, now), done ? ts(it.completedAt, now) : null);
        continue;
      }
      const completedAt = done ? row.completed_at ?? ts(it.completedAt, now) : null; // keep the original completion time
      if (row.text !== text || row.completed_at !== completedAt || row.removed_at != null) q.update.run(text, completedAt, instanceId, id);
    }
    for (const [id, row] of known) if (!present.has(id) && row.removed_at == null) q.remove.run(now, instanceId, id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function history(instanceId, page, pageSize, completedOnly) {
  open();
  const where = `instance_id = ?${completedOnly ? ' AND completed_at IS NOT NULL' : ''}`;
  const total = db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE ${where}`).get(instanceId).n;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const p = Math.min(Math.max(1, page), pages);
  const rows = db
    .prepare(
      `SELECT task_id AS id, text, created_at AS createdAt, completed_at AS completedAt, removed_at AS removedAt
         FROM tasks WHERE ${where}
        ORDER BY completed_at IS NULL, completed_at DESC, created_at DESC
        LIMIT ? OFFSET ?`
    )
    .all(instanceId, pageSize, (p - 1) * pageSize);
  return { total, page: p, pages, pageSize, rows };
}

const bad = (message) => Object.assign(new Error(message), { status: 400, expose: true });
const idOf = (v) => {
  const s = String(v ?? '').trim();
  if (!s || s.length > 64) throw bad('instanceId is missing or invalid');
  return s;
};

export default {
  id: 'todo',
  name: 'Todo',
  description: 'Keeps a history of tasks (created / completed) in SQLite',
  routes(router) {
    router.post('/sync', (req, res) => {
      const items = req.body?.items;
      if (!Array.isArray(items)) throw bad('items must be an array');
      sync(idOf(req.body?.instanceId), items);
      res.json({ ok: true });
    });

    router.get('/history', (req, res) => {
      const size = Math.min(50, Math.max(1, Math.round(Number(req.query.pageSize)) || 10));
      const page = Math.max(1, Math.round(Number(req.query.page)) || 1);
      res.json(history(idOf(req.query.instanceId), page, size, req.query.filter === 'completed'));
    });
  },
};
