import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Pull-request validation has no production secrets. Give that build a fake host so
// Playwright can intercept every request. Releases already provide the real values.
if (process.env.GITHUB_ACTIONS === 'true' && !process.env.VITE_SUPABASE_URL) {
  process.env.VITE_SUPABASE_URL = 'https://nexo-smoke.supabase.co';
  process.env.VITE_SUPABASE_ANON_KEY = 'nexo-smoke-anon-key';
}

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    strictPort: true,
    port: 5173,
    host: '127.0.0.1'
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(process.cwd(), 'index.html'),
        admin: resolve(process.cwd(), 'admin.html')
      }
    }
  },
  envPrefix: ['VITE_', 'TAURI_']
});
