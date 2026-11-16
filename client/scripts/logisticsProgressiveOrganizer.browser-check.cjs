const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { build } = require('esbuild');
const { chromium } = require('playwright-core');

test('customer-view organizer shortcut opens the workspace and new-campaign form returns there', { timeout: 30_000 }, async () => {
  const root = path.resolve(__dirname, '..');
  const bundle = await build({
    stdin: {
      resolveDir: root,
      loader: 'jsx',
      contents: `
        import React, { useState } from 'react';
        import { createRoot } from 'react-dom/client';
        import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
        import { navbarNavigation } from './src/utils/navbarNavigation.js';
        import NewCampaignPage from './src/pages/logistics/NewCampaignPage.jsx';

        function CustomerNavigation() {
          const [granted, setGranted] = useState(true);
          const projection = { flags: { accessProjection: true }, access: { personal: granted ? ['customer', 'logistics.ship'] : ['customer'], organizations: [] } };
          const navigation = navbarNavigation({ id: 'customer-1', role: 'customer', default_mode: 'customer' }, { projection });
          return <nav aria-label="Customer account navigation">
            {navigation.account.map((item) => <Link key={item.id} to={item.to}>{item.id}</Link>)}
            <button type="button" onClick={() => setGranted(false)}>Revoke</button>
          </nav>;
        }

        function OrganizerWorkspace() {
          return <main><h1>Organizer workspace</h1><Link to="/logistics/campaigns/new">Start a campaign</Link></main>;
        }

        createRoot(document.getElementById('root')).render(<BrowserRouter><CustomerNavigation /><Routes>
          <Route path="/" element={<main><h1>Customer Home</h1></main>} />
          <Route path="/logistics/organizer" element={<OrganizerWorkspace />} />
          <Route path="/logistics/campaigns/new" element={<NewCampaignPage />} />
        </Routes></BrowserRouter>);
      `,
    },
    bundle: true,
    write: false,
    jsx: 'automatic',
    loader: { '.css': 'empty', '.js': 'jsx' },
    define: { 'import.meta.env': '{}' },
    plugins: [{
      name: 'progressive-organizer-fixtures',
      setup(plugin) {
        const fixtures = {
          'react-i18next': `export const useTranslation=()=>({t:(key,opts={})=>opts.defaultValue||key});`,
          '../../api/logistics': `export const createCampaign=async()=>({data:{id:17}});`,
          '../../components/PageShell': `import React from 'react'; export default ({children}) => <>{children}</>;`,
          '../../components/logistics/CampaignDraftForm': `import React from 'react'; export default ({backTo,backLabel,heading}) => <section><h1>{heading}</h1><a href={backTo}>{backLabel}</a></section>;`,
        };
        plugin.onResolve({ filter: /^(react-i18next|\.\.\/\.\.\/api\/logistics|\.\.\/\.\.\/components\/PageShell|\.\.\/\.\.\/components\/logistics\/CampaignDraftForm)$/ }, ({ path: modulePath }) => ({ path: modulePath, namespace: 'fixture' }));
        plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({ resolveDir: root, contents: fixtures[args.path], loader: 'jsx' }));
      },
    }],
  });

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.route('http://progressive-organizer.test/**', async (route) => {
      const { pathname } = new URL(route.request().url());
      if (pathname === '/fixture.js') return route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text });
      return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div><script defer src="/fixture.js"></script>' });
    });

    await page.goto('http://progressive-organizer.test/');
    const organizerLink = page.getByRole('link', { name: 'logisticsOrganizer', exact: true });
    await organizerLink.waitFor();
    assert.equal(await organizerLink.getAttribute('href'), '/logistics/organizer');
    await organizerLink.click();
    await page.getByRole('heading', { name: 'Organizer workspace', exact: true }).waitFor();
    await page.getByRole('link', { name: 'Start a campaign', exact: true }).click();
    await page.getByRole('heading', { name: 'Start a new campaign', exact: true }).waitFor();
    const back = page.getByRole('link', { name: 'Back to organizer workspace', exact: true });
    assert.equal(await back.getAttribute('href'), '/logistics/organizer');
    await back.click();
    await page.getByRole('heading', { name: 'Organizer workspace', exact: true }).waitFor();

    await page.getByRole('button', { name: 'Revoke', exact: true }).click();
    assert.equal(await page.getByRole('link', { name: 'logisticsOrganizer', exact: true }).count(), 0);
  } finally {
    await browser.close();
  }
});
