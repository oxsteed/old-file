import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';

test('Learn renders its catalog, search results, and guide deep links without initialization errors', async () => {
  const mocks = {
    'react-i18next': `export const useTranslation = () => ({ t: (key) => key });`,
    '../context/AuthContext': `export const useAuth = () => ({ user: null });`,
    '../hooks/useRecommendations': `export default () => ({ refresh: () => {} });`,
    '../components/PageShell': `export default ({ children }) => <main>{children}</main>;`,
    '../components/PageMeta': `export default () => null;`,
    '../api/axios': `export default {};`,
    '../api/marketplaceApi': `export const marketplaceApi = {};`,
  };
  const result = await build({
    stdin: {
      contents: `import React from 'react';
        import { renderToString } from 'react-dom/server';
        import { MemoryRouter } from 'react-router-dom';
        import LearnModePage from './src/pages/LearnModePage.jsx';
        export const render = (entry) => renderToString(
          <MemoryRouter initialEntries={[entry]}><LearnModePage /></MemoryRouter>
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
    loader: { '.css': 'empty' },
    define: { 'import.meta.env': '{}' },
    plugins: [{ name: 'learn-render-dependencies', setup(plugin) {
      plugin.onResolve({ filter: /.*/ }, ({ path }) => mocks[path]
        ? { path, namespace: 'learn-test' } : undefined);
      plugin.onLoad({ filter: /.*/, namespace: 'learn-test' }, ({ path }) => ({
        contents: mocks[path], loader: 'jsx',
      }));
    }}],
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(
    createRequire(import.meta.url), module, module.exports);

  for (const entry of ['/learn', '/learn?q=faucet', '/learn?guide=fix-leaky-faucet']) {
    const html = module.exports.render(entry);
    assert.match(html, /learn\.page\.hero\.guest\.title/);
    assert.match(html, /Fix a Leaky Faucet/);
    if (entry.includes('guide=')) assert.match(html, /Turn off the water supply valves/);
  }
  const emptyHtml = module.exports.render('/learn?q=zzzz-no-matching-guide');
  assert.match(emptyHtml, /learn\.page\.noResults/);
  assert.doesNotMatch(emptyHtml, /Fix a Leaky Faucet/);
});
