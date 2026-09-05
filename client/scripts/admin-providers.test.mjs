import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

test('admin providers render the real two-factor page and shared footer', async () => {
  const result = await build({
    stdin: {
      contents: `
        import React from 'react';
        import { renderToString } from 'react-dom/server';
        import { MemoryRouter } from 'react-router-dom';
        import AdminProviders from './src/admin/AdminProviders';
        import TwoFactorSetup from './src/pages/Settings/TwoFactorSetup';
        import { AuthProvider } from './src/context/AuthContext';
        import { LanguageProvider } from './src/context/LanguageContext';
        import { ThemeProvider } from './src/context/ThemeContext';
        export const renderMissingConsent = () => renderToString(
          <LanguageProvider><ThemeProvider><AuthProvider><MemoryRouter>
            <TwoFactorSetup adminSetup />
          </MemoryRouter></AuthProvider></ThemeProvider></LanguageProvider>
        );
        export const render = () => renderToString(
          <AdminProviders><MemoryRouter initialEntries={['/admin/2fa-setup']}>
            <TwoFactorSetup adminSetup />
          </MemoryRouter></AdminProviders>
        );`,
      resolveDir: fileURLToPath(new URL('..', import.meta.url)),
      loader: 'jsx',
    },
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    external: ['react', 'react-dom', 'react-dom/*'],
    loader: { '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl' },
    define: { 'import.meta.env': '{}' },
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(
    createRequire(import.meta.url), module, module.exports);
  assert.throws(module.exports.renderMissingConsent, /useCookieConsentContext must be used within/);
  const html = module.exports.render();
  assert.match(html, /<footer/);
  assert.match(html, /support@oxsteed.com/);
});
