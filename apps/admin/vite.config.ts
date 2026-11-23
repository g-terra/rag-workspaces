import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// In development the UI calls `/api/...` and Vite forwards it to the API, the same
// way nginx does in the container, so the UI never needs CORS or the API's own URL.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 5173,
    proxy: {
      // A regex, so only real API calls are forwarded: a plain '/api' prefix would also catch the
      // app's own /api-keys page, which nginx leaves to the router (`location /api/`).
      '^/api/': {
        target: process.env.API_URL ?? 'http://localhost:3000',
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  test: { include: ['src/**/*.test.{ts,tsx}'], environment: 'node' },
});
