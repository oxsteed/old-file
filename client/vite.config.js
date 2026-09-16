import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN;
  const sentryOrg = process.env.SENTRY_ORG;
  const sentryProject = process.env.SENTRY_PROJECT;
  const sentryUpload =
    mode === 'production' && sentryAuthToken && sentryOrg && sentryProject;

  return {
  plugins: [
    react(),
    ...(sentryUpload
      ? [
          sentryVitePlugin({
            org: sentryOrg,
            project: sentryProject,
            authToken: sentryAuthToken,
            release: process.env.SENTRY_RELEASE || process.env.COMMIT_SHA || process.env.SOURCE_COMMIT || undefined,
          }),
        ]
      : []),
  ],

  // Strip most console.* calls from the production bundle so internal paths
  // and API shapes aren't visible in browser DevTools.
  // console.error is intentionally kept - ErrorBoundary relies on it to
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
        // Isolated Credit browser runs publish the API on a disposable port;
        // production builds do not use this dev-server proxy.
        target: process.env.VITE_DEV_API_PROXY_TARGET || 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },

  build: {
    outDir: 'dist',
    sourcemap: sentryUpload ? 'hidden' : mode === 'production' ? false : true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        admin: resolve(__dirname, 'admin.html'),
      },
    },
  },
};
});
