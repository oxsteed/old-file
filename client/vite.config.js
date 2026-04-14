import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => ({
  plugins: [react()],

  // Strip most console.* calls from the production bundle so internal paths
  // and API shapes aren't visible in browser DevTools.
  // console.error is intentionally kept — ErrorBoundary relies on it to
  // surface uncaught render errors, and it carries no sensitive internals.
  // esbuild must be a TOP-LEVEL key; build.esbuild is not recognised by Vite.
  esbuild: mode === 'production'
    ? {
        drop: ['debugger'],
        pure: ['console.log', 'console.warn', 'console.debug', 'console.info', 'console.trace'],
      }
    : {},

  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },

  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        admin: resolve(__dirname, 'admin.html'),
      },
    },
  },
}));
