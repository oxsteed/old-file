import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
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
    // Strip console.log / console.warn / console.debug from the production
    // bundle so internal paths and API shapes aren't visible in DevTools.
    // console.error is intentionally kept — ErrorBoundary relies on it to
    // surface uncaught render errors and it carries no sensitive internals.
    esbuild: mode === 'production'
      ? { drop: ['debugger'], pure: ['console.log', 'console.warn', 'console.debug', 'console.info', 'console.trace'] }
      : {},
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        admin: resolve(__dirname, 'admin.html'),
      },
    },
  },
}));
