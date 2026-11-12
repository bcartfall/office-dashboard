import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import { DEV_PORT, VITE_PORT } from '../server/lib/config.js';

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  server: {
    // Development uses its own ports so it can run next to the production server (:3944).
    port: VITE_PORT, // 5256
    strictPort: true,
    proxy: { '/api': { target: `http://localhost:${DEV_PORT}`, changeOrigin: true } }, // 3943
  },
  build: { outDir: 'dist', chunkSizeWarningLimit: 700 },
});
