import { Router } from 'express';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { DATA_DIR } from './config.js';

const FILE = path.join(DATA_DIR, 'layout.json');

/** Emits 'change' (layout) whenever the saved layout changes - from this server or from another one sharing the file. */
export const layoutEvents = new EventEmitter();

export async function readLayout() {
  try {
    return JSON.parse(await fs.readFile(FILE, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT' || err instanceof SyntaxError) return null;
    throw err;
  }
}

/** Every plugin instance in the layout: [{ id, type, config }] */
export function pluginInstances(layout) {
  const out = [];
  for (const panel of Array.isArray(layout?.panels) ? layout.panels : []) {
    for (const p of Array.isArray(panel?.plugins) ? panel.plugins : []) {
      if (p && typeof p.id === 'string' && typeof p.type === 'string') out.push({ id: p.id, type: p.type, config: p.config && typeof p.config === 'object' ? p.config : {} });
    }
  }
  return out;
}

// The dev and production servers share layout.json; notice edits made through the other one.
let lastMtime = 0;
const stat = () => {
  try {
    return fsSync.statSync(FILE).mtimeMs;
  } catch {
    return 0;
  }
};
lastMtime = stat();
const watcher = setInterval(async () => {
  const m = stat();
  if (m === lastMtime) return;
  lastMtime = m;
  const layout = await readLayout().catch(() => null);
  if (layout) layoutEvents.emit('change', layout);
}, 5000);
watcher.unref();

const router = Router();

router.get('/', async (_req, res) => {
  res.json({ layout: await readLayout() });
});

router.put('/', async (req, res) => {
  const layout = req.body?.layout;
  if (!layout || !Array.isArray(layout.panels)) {
    return res.status(400).json({ error: 'layout.panels must be an array' });
  }
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(layout, null, 2), 'utf8');
  await fs.rename(tmp, FILE); // atomic replace
  lastMtime = stat();
  layoutEvents.emit('change', layout);
  res.json({ ok: true });
});

export default router;
