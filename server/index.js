import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { guard } from './lib/security.js';
import layoutRouter from './lib/layout.js';
import { historyRouter, startBackground } from './lib/background.js';
import { PORT, HOST, DEV, VITE_PORT } from './lib/config.js';
import { loadPlugins } from './plugins/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// HOST defaults to loopback only: this server can launch programs on your machine.

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

// ---- API ------------------------------------------------------------------
app.use('/api', guard({ port: PORT }));
app.get('/api/health', (_req, res) => res.json({ ok: true, time: Date.now() }));
app.use('/api/layout', layoutRouter);
app.use('/api/history', historyRouter);

const plugins = await loadPlugins();
app.get('/api/plugins', (_req, res) =>
  res.json(plugins.map(({ id, name, description }) => ({ id, name, description })))
);
for (const plugin of plugins) {
  const router = express.Router();
  plugin.routes(router);
  app.use(`/api/plugins/${plugin.id}`, router);
}

startBackground(plugins);

// Unknown API routes -> JSON 404 (not the SPA)
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// ---- Static frontend (production build) ----------------------------------
// Checked per request so running "npm run build" while the server is up just works.
const dist = path.resolve(__dirname, '../web/dist');
const serveStatic = express.static(dist);
app.use((req, res, next) => (fs.existsSync(dist) ? serveStatic(req, res, next) : next()));
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  const index = path.join(dist, 'index.html');
  if (fs.existsSync(index)) return res.sendFile(index);
  res
    .type('text/plain')
    .send('Frontend not built. Run "npm run build" (or "npm run dev:web" for the Vite dev server).');
});

// ---- Errors ----------------------------------------------------------------
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.expose || status < 500 ? err.message : 'Internal error' });
});

app.listen(PORT, HOST, () => {
  console.log(`Office dashboard${DEV ? ' (development)' : ''} API at http://localhost:${PORT}`);
  if (DEV) console.log(`Vite dev server: http://localhost:${VITE_PORT}`);
  console.log(`Plugins: ${plugins.map((p) => p.id).join(', ')}`);
});
