import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Development mode is switched on by the `--dev` flag (see `npm run dev:*`), which works the
 * same on every OS (no NODE_ENV / cross-env needed). Dev and production use different ports
 * so both can run side by side.
 */
export const DEV = process.argv.includes('--dev');
export const PROD_PORT = 3944;
export const DEV_PORT = 3943; // API in development
export const VITE_PORT = 5256; // Vite dev server (proxies /api to DEV_PORT)

export const PORT = Number(process.env.PORT) || (DEV ? DEV_PORT : PROD_PORT);
export const HOST = process.env.HOST || '127.0.0.1';
export const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, '../../data');
