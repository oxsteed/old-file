import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function largeChunkAudit() {
  const warningLimitBytes = 500 * 1024;

  return {
    name: 'oxsteed-large-chunk-audit',
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue;

        const isMapLibreVendor = output.name === 'maplibre-vendor';
        const size = Buffer.byteLength(output.code);

        // MapLibre ships as one prebuilt engine; it is route-lazy-loaded and
        // about 285 kB gzipped, so keep it as the sole documented exception.
        if (size > warningLimitBytes && !isMapLibreVendor) {
          this.warn(`Large chunk ${output.fileName}: ${(size / 1024).toFixed(1)} KiB minified (500 KiB target).`);
        }
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN;
  const sentryOrg = process.env.SENTRY_ORG;
  const sentryProject = process.env.SENTRY_PROJECT;
  const sentryUpload =
    mode === 'production' && sentryAuthToken && sentryOrg && sentryProject;

  return {
  plugins: [
    react(),
    largeChunkAudit(),
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
    // MapLibre's prebuilt engine is the only bundle allowed above 500 KiB;
    // largeChunkAudit keeps the original target active for every other chunk.
    chunkSizeWarningLimit: 1100,
    sourcemap: sentryUpload ? 'hidden' : mode === 'production' ? false : true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        admin: resolve(__dirname, 'admin.html'),
      },
      output: {
        manualChunks(id) {
          if (id.replaceAll('\\', '/').includes('/node_modules/maplibre-gl/')) {
            return 'maplibre-vendor';
          }
        },
      },
    },
  },
};
});
