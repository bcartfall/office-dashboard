import { Router } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, '../../data');
const FILE = path.join(DATA_DIR, 'layout.json');

const router = Router();

router.get('/', async (_req, res) => {
  try {
    const raw = await fs.readFile(FILE, 'utf8');
    res.json({ layout: JSON.parse(raw) });
  } catch (err) {
    if (err.code === 'ENOENT') return res.json({ layout: null });
    throw err;
  }
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
  res.json({ ok: true });
});

export default router;
