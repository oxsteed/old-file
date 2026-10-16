/**
 * discover.cjs - per-area discovery: for each screen, load it in the fixture,
 * dump the API log + interactive elements, and save a raw screenshot for
 * inspection. Output: /tmp/sop-discover/<area>/.
 *
 * Usage: node client/scripts/sop/discover.cjs <area>
 * Area "all" discovers every screen (slow; prefer per-area).
 */
const path = require('node:path');
const fs = require('node:fs');
const {loadPlans} = require('./plans.cjs');
const { startAppFixture, launchBrowser, newFixturePage, settle, apiLog } = require('./harness.cjs');
const { buildApiMockSource } = require('./fixtures.cjs');
const { routeForScreen } = require('./recipes.cjs');

const USERS = {
  guest: null,
  customer: {
    id: 'sop-user-customer', email: 'sop.customer@example.com', first_name: 'Sop', last_name: 'Customer',
    role: 'customer', email_verified: true, didit_status: 'verified', onboarding_step: 'active',
  },
  helper: {
    id: 'sop-user-helper', email: 'sop.helper@example.com', first_name: 'Sam', last_name: 'Helper',
    role: 'helper', email_verified: true, didit_status: 'verified', onboarding_step: 'active',
  },
};

function guessUser(plan) {
  if (/guest/.test(plan.state)) return 'guest';
  return 'customer';
}

async function dumpElements(page) {
  return page.evaluate(() => {
    const out = { buttons: [], inputs: [], selects: [], headings: [], tabs: [], links: [] };
    const text = (el) => (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    for (const el of document.querySelectorAll('button')) {
      if (el.offsetParent === null) continue;
      out.buttons.push(text(el) + (el.disabled ? ' [disabled]' : ''));
      if (out.buttons.length >= 40) break;
    }
    for (const el of document.querySelectorAll('input, textarea')) {
      if (el.type === 'hidden') continue;
      out.inputs.push(`${el.tagName.toLowerCase()}[type=${el.type || '-'} name=${el.name || '-'} placeholder=${el.placeholder || '-'}]${el.offsetParent === null ? ' (hidden)' : ''}`);
      if (out.inputs.length >= 40) break;
    }
    for (const el of document.querySelectorAll('select')) {
      out.selects.push(`select[name=${el.name || '-'}] opts=${[...el.options].map((o) => o.text.trim().slice(0, 25)).join('|').slice(0, 120)}`);
      if (out.selects.length >= 15) break;
    }
    for (const el of document.querySelectorAll('h1, h2')) {
      if (el.offsetParent === null) continue;
      out.headings.push(text(el));
      if (out.headings.length >= 12) break;
    }
    for (const el of document.querySelectorAll('[role=tab]')) {
      if (el.offsetParent === null) continue;
      out.tabs.push(text(el));
      if (out.tabs.length >= 20) break;
    }
    for (const el of document.querySelectorAll('main a[href], nav a[href]')) {
      if (el.offsetParent === null) continue;
      out.links.push(`${text(el).slice(0, 40)} -> ${el.getAttribute('href')}`);
      if (out.links.length >= 25) break;
    }
    return out;
  }).catch(() => ({}));
}

async function main() {
  const plans = await loadPlans();
  const area = process.argv[2] || 'account';
  const areaPlans = plans.filter((p) => area === "all" || p.area === area);
  const screens = [...new Set(areaPlans.map((p) => p.screen))];
  console.log(`Area ${area}: ${areaPlans.length} plans, ${screens.length} screens`);

  const outDir = `/tmp/sop-discover/${area}`;
  fs.mkdirSync(outDir, { recursive: true });

  const {port,close} = await startAppFixture();
  const browser = await launchBrowser();
  const report = [];

  try {
    for (const screen of screens) {
      const url = routeForScreen(screen);
      const samplePlan = areaPlans.find((p) => p.screen === screen);
      const userKey = guessUser(samplePlan);
      const page = await newFixturePage(browser, {
        viewport: { width: 1360, height: 900 },
        user: USERS[userKey], dataMode: 'full',
      });
      const errors = [];
      page.on('pageerror', (e) => errors.push(String((e && e.message) || e)));
      await page.goto(`http://127.0.0.1:${port}${url}`, { waitUntil: 'domcontentloaded' }).catch((e) => errors.push('NAV: ' + e.message));
      const s = await settle(page);
      const finalUrl = page.url();
      const log = await apiLog(page);
      const els = await dumpElements(page);
      const shotName = screen.replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 80) || 'root';
      await page.screenshot({ path: path.join(outDir, `${shotName}.jpg`), type: 'jpeg', quality: 60 }).catch(() => {});
      report.push({ screen, url, finalUrl: finalUrl.replace(`http://127.0.0.1:${port}`, ''), mounted: s.mounted, user: userKey, api: log, errors: errors.slice(0, 4), elements: els });
      console.log(`  ${screen} -> ${report[report.length - 1].finalUrl} api=${log.length} err=${errors.length}`);
      await page.close();
    }
  } finally {
    await browser.close();
    await close();
  }
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 1));
  console.log('Report:', path.join(outDir, 'report.json'));
}

main().catch((e) => { console.error('DISCOVER FAILED:', e); process.exit(1); });
