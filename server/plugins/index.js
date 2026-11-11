/**
 * Plugin loader. Every other *.js file in this folder is a backend plugin:
 *
 *   export default {
 *     id: 'my-plugin',            // mounted at /api/plugins/my-plugin
 *     name: 'My Plugin',
 *     description: '...',
 *     routes(router) { router.get('/data', async (req, res) => res.json({...})) },
 *   };
 *
 * Drop a file in, restart the server, done. The matching Vue component is
 * registered in web/src/plugins/index.js.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));

export async function loadPlugins() {
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.js') && f !== 'index.js')
    .sort();

  const plugins = [];
  for (const file of files) {
    const mod = await import(pathToFileURL(path.join(dir, file)).href);
    const plugin = mod.default;
    if (!plugin?.id || typeof plugin.routes !== 'function') {
      console.warn(`Skipping plugins/${file}: missing id or routes()`);
      continue;
    }
    plugins.push(plugin);
  }
  return plugins;
}
