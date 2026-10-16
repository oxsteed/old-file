/**
 * capture.cjs - SOP screenshot capture driver.
 *
 * Usage: node client/scripts/sop/capture.cjs <area> [--screen <screen-substr>]
 *
 * For every plan in the area (both viewports):
 *   - dedup on (screen, state, viewport): capture once, share src
 *   - union-measure annotations when plans share a combo but differ
 * Writes:
 *   client/public/sop/screenshots/<area>/<guide-id>/<stepId>-<viewport>.jpg
 *   client/src/sop/screenshots.json   (merged with existing entries)
 *
 * Progress: /tmp/sop-capture/<area>-progress.json (resume by deleting entries)
 */
const path = require('node:path');
const fs = require('node:fs');
const { loadPlans } = require('./plans.cjs');
const H = require('./harness.cjs');
const { buildApiMockSource } = require('./fixtures.cjs');
const { routeForScreen, recipeFor, USERS } = require('./recipes.cjs');

const SHOTS_DIR = path.join(H.ROOT, 'public/sop/screenshots');
const MANIFEST_PATH = path.join(H.ROOT, 'src/sop/screenshots.json');

// Annotation locator fallbacks: plan key "<guideId>/<stepId>" -> { <n>: replacementLocator }.
// Used when the plan's locator does not match the current DOM; the replacement
// targets the element the annotation describes. Reported in the final summary.
const LOCATOR_FALLBACKS = {
  'account-identity-verification/account-identity-verification-s1': { 1: '.verify-identity-nav-badge' },
  'account-identity-verification/account-identity-verification-s2': { 1: '.verify-identity-card', 2: '.verify-identity-card button' },
  'account-identity-verification/account-identity-verification-s3': { 1: '.verify-identity-card', 2: '.verify-identity-card' },
  'account-join/account-join-s3': { 1: '#termsAccepted' },
  'account-join/account-join-s4': { 1: '.signup-otp-input', 2: '.signup-otp-input' }, // desktop: no submit button in the OTP UI (auto-verifies); point at the code field
  'account-password-recovery/account-password-recovery-s1': { 1: '#email' },
  'account-password-recovery/account-password-recovery-s2': { 1: 'main .w-16.h-16' }, // sent-confirmation icon block (no .confirmation class in current UI)
  'account-password-recovery/account-password-recovery-s3': { 1: '#password', 2: '#confirmPassword' },
  'account-privacy/account-privacy-s2': { 1: 'main input[type="checkbox"]' }, // no submit button; toggles save immediately
  'account-privacy/account-privacy-s4': { 1: '.sp-confirm-box', 3: '.sp-confirm-box' }, // Danger Zone confirm box (no dialog in current UI)
  'account-settings/account-settings-s1': { 1: '.sp-sidebar' },
  'account-settings/account-settings-s3': {
    // /settings/security is not a route; the Security tab renders .sp-card divs (no sections)
    1: 'xpath=(//main//div[contains(@class,"sp-card")])[1]',
    2: 'xpath=(//main//div[contains(@class,"sp-card")])[2]',
    3: 'xpath=(//main//div[contains(@class,"sp-card")])[3]',
  },
  'account-signin/account-signin-s1': { 1: '#email' },
  'account-signin/account-signin-s4': { 1: 'nav .ox-nav-account' },
  'account-support/account-support-s1': { 1: 'main input[type="text"]' }, // live-chat composer is an input, not a textarea
  // business-work fallbacks (guide locators vs actual UI classes)
  'business-work-clients/business-work-clients-s1': { 3: "xpath=(//main//div[.//text()[contains(.,'jane@example.com')]])[1]" },
  'business-work-invoices/business-work-invoices-s1': { 1: '.bh-kpi-grid' },
  'business-work-jobs/business-work-jobs-s2': { 1: "xpath=(//main//*[contains(text(),'Fix leaky')])[1]" },
  'business-work-jobs/business-work-jobs-s3': { 2: "xpath=(//main//*[contains(text(),'applicant') or contains(text(),'Applicant')])[1]" },
  'business-work-jobs/business-work-jobs-s4': { 1: "xpath=//main//*[contains(text(),'Pipeline') or contains(text(),'pipeline')][1]", 2: "xpath=(//main//button)[1]" },
  'business-work-scheduling/business-work-scheduling-s2': { 1: "xpath=//main//*[contains(text(),'Business hours') or contains(text(),'Hours')][1]" },
  'business-work-scheduling/business-work-scheduling-s3': { 1: "xpath=(//main//button[contains(text(),'All') or contains(text(),'Upcoming')])[1]", 2: "xpath=(//main//*[contains(text(),'Faucet repair')])[1]" },
  'business-work-select/business-work-select-s2': { 2: "xpath=//main//*[contains(text(),'Owner') or contains(text(),'owner')][1]" },
  'business-work-services/business-work-services-s1': { 2: "xpath=(//main//*[contains(text(),'Faucet Repair')])[1]" },
  'business-work-setup/business-work-setup-s1': { 1: "xpath=(//main//*[contains(text(),'package') or contains(text(),'Package')])[1]" },
  'business-work-team-access/business-work-team-access-s1': { 2: "xpath=//main//table[1]" },
  // helper-work fallbacks
  'helper-work-assigned-jobs/helper-work-assigned-jobs-s1': { 1: "xpath=//main//*[contains(text(),'Calendar') or contains(text(),'calendar')][1]" },
  'helper-work-assigned-jobs/helper-work-assigned-jobs-s2': { 1: "xpath=//main//*[contains(text(),'Pending') or contains(text(),'request')][1]", 2: "xpath=(//main//button)[1]" },
  'helper-work-assigned-jobs/helper-work-assigned-jobs-s4': { 1: "xpath=(//main//*[contains(text(),'Fix leaky')])[1]" },
  'helper-work-bid/helper-work-bid-s1': { 1: "xpath=(//main//p)[1]", 2: "xpath=//main//form[1]" },
  'helper-work-bid/helper-work-bid-s2': { 1: "xpath=//main//input[@type='number'][1]", 2: "xpath=//main//input[@type='number'][2]", 3: "xpath=//main//textarea[1]" },
  'helper-work-bid/helper-work-bid-s3': { 1: "xpath=//main//button[@type='submit'][1]" },
  'helper-work-skills/helper-work-skills-s3': { 2: "xpath=//main//input[@type='checkbox'][1]" },
  // hiring fallbacks
  'hiring-book/hiring-book-s1': { 1: "xpath=//main//*[contains(text(),'Choose a date')][1]", 2: "xpath=(//main//button[contains(.,'16')])[1]" },
  'hiring-book/hiring-book-s2': { 1: "xpath=(//main//button[contains(.,'16')])[1]", 2: "xpath=//main//input[@type='checkbox'][1]" },
  'hiring-book/hiring-book-s3': { 1: "xpath=(//main//nav)[1]", 2: "xpath=(//main//article)[1]" },
  'hiring-cancellations/hiring-cancellations-s1': { 2: "xpath=//main//div[@role='dialog' or @role='alertdialog'][1]" },
  'hiring-cancellations/hiring-cancellations-s2': { 1: "xpath=//main//h2[1]", 2: "xpath=//main//textarea[1]" },
  'hiring-cancellations/hiring-cancellations-s3': { 1: "xpath=//main//input[@type='number'][1]" },
  'hiring-work-agreements/hiring-work-agreements-s4': { 3: "xpath=(//main//section)[2]" },
  'account-support/account-support-s2': { 1: '.support-escalation-success' },
  'account-support/account-support-s3': { 2: "xpath=//section[.//h2[normalize-space()='Messages']]" },
};
// mobile menu: scope the mode-switcher trigger to the open mobile menu
// (applied only for the mobile viewport)
const LOCATOR_FALLBACKS_MOBILE = {
  'account-mode-switching/account-mode-switching-s1': { 1: '.ox-nav-mobile-menu [data-nav-disclosure] button' },
  'account-mode-switching/account-mode-switching-s3': { 1: '.ox-nav-mobile-menu [data-nav-disclosure] button' },
  'account-join/account-join-s4': { 1: '.signup-otp-input' }, // no submit button in the OTP UI; point at the code field
  'account-support/account-support-s3': { 1: "xpath=//section[.//h2[normalize-space()='Messages']]" },
};

function resolveLocator(planKey, annotation, vp) {
  if (vp === 'mobile') {
    const fbm = LOCATOR_FALLBACKS_MOBILE[planKey];
    if (fbm && fbm[annotation.n]) return fbm[annotation.n];
  }
  const fb = LOCATOR_FALLBACKS[planKey];
  if (fb && fb[annotation.n]) return fb[annotation.n];
  return annotation.locator;
}

/** Query one element: supports "xpath=..." prefix, prefers visible matches. */
async function queryBox(page, locator) {
  return page.evaluate((loc) => {
    const visible = (el) => {
      if (!el || el.offsetParent === null) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const all = (l) => {
      if (l.startsWith('xpath=')) {
        const out = [];
        const it = document.evaluate(l.slice(6), document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        for (let i = 0; i < it.snapshotLength; i++) out.push(it.snapshotItem(i));
        return out;
      }
      try {
        // Prefer the main content scope; fall back to document scope
        // (annotations describe screen content, not the navbar).
        const scoped = [...document.querySelectorAll('main ' + l)];
        if (scoped.length) return scoped;
        return [...document.querySelectorAll(l)];
      } catch (e) {
        return [...document.querySelectorAll(l)];
      }
    };
    let els = all(loc);
    if (!els.length) return null;
    // Ambiguous disclosure trigger: prefer the visible ModeSwitcher button.
    if (loc === '[data-nav-disclosure] button') {
      const modeBtn = els.find((el) => visible(el) && /mode/i.test(el.textContent || ''));
      if (modeBtn) els = [modeBtn, ...els.filter((e) => e !== modeBtn)];
    }
    const el = els.find(visible);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, locator);
}

async function measureUnion(page, items, viewport) {
  // items: [{ planKey, n, label, locator }]
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  const boxes = [];
  for (const it of items) boxes.push(await queryBox(page, it.locator));
  const centers = boxes.map((b) => (b ? { cx: b.x + b.w / 2, cy: b.y + b.h / 2 } : null));
  const valid = centers.filter(Boolean);
  if (valid.length) {
    const minY = Math.min(...valid.map((c) => c.cy));
    const maxY = Math.max(...valid.map((c) => c.cy));
    const vh = viewport.height;
    let scrollY = 0;
    if (minY < 0 || maxY > vh) {
      scrollY = Math.max(0, minY - vh * 0.3);
      if (maxY - minY > vh * 0.9) scrollY = Math.max(0, valid[0].cy - vh * 0.3);
      await page.evaluate((y) => window.scrollTo(0, y), Math.round(scrollY));
      await page.waitForTimeout(400);
    }
  }
  const out = [];
  for (let i = 0; i < items.length; i++) {
    const box = await queryBox(page, items[i].locator);
    if (!box) { out.push({ ...items[i], found: false }); continue; }
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    if (cx <= 0 || cy <= 0 || cx >= viewport.width || cy >= viewport.height) { out.push({...items[i], found:false}); continue; }
    out.push({
      ...items[i], found: true,
      x: Math.round((cx / viewport.width) * 1000) / 10,
      y: Math.round((cy / viewport.height) * 1000) / 10,
    });
  }
  return out;
}

async function main() {
  const plans = await loadPlans();
  const area = process.argv[2];
  if (!area) { console.error('usage: capture.cjs <area> [--screen <substr>]'); process.exit(1); }
  const screenFilter = process.argv.includes('--screen') ? process.argv[process.argv.indexOf('--screen') + 1] : null;

  let areaPlans = plans.filter((p) => area === 'all' || p.area === area);
  if (screenFilter) areaPlans = areaPlans.filter((p) => p.screen.includes(screenFilter));
  if (process.argv.includes('--guide')) areaPlans = areaPlans.filter(p => process.argv[process.argv.indexOf('--guide')+1].split(',').includes(p.guide));
  if (process.argv.includes('--missing')) {
    const existing = fs.existsSync(MANIFEST_PATH) ? JSON.parse(fs.readFileSync(MANIFEST_PATH)) : {};
    areaPlans = areaPlans.filter(p => !existing[`${p.guide}/${p.step}/${p.vp}`]);
  }
  console.log(`Area ${area}: ${areaPlans.length} plans`);

  // Screens the app redirects away from per launchScope.js (launch-gated);
  // these cannot be captured without changing app behavior. Recorded as
  // flagged gaps in the final report.
  const SKIP_SCREENS = new Set([
    '/business-launch-status', '/consultant-availability', '/car-care',
    '/consulting/portal', '/planned-needs',
  ]);
  // group plans by combo
  const combos = new Map();
  for (const p of areaPlans) {
    const k = JSON.stringify([p.screen, p.vp, recipeFor(p)]);
    if (!combos.has(k)) combos.set(k, []);
    combos.get(k).push(p);
  }
  console.log(`Unique combos: ${combos.size}`);

  const progressPath = `/tmp/sop-capture/${area}-progress.json`;
  fs.mkdirSync('/tmp/sop-capture', { recursive: true });
  let done = new Set();
  if (!process.argv.includes('--force') && fs.existsSync(progressPath)) {
    try { done = new Set(JSON.parse(fs.readFileSync(progressPath, 'utf8')).done || []); } catch {}
  }

  const {port,close} = await H.startAppFixture();
  const browser = await H.launchBrowser();

  let manifest = {};
  if (fs.existsSync(MANIFEST_PATH)) {
    try { manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')); } catch {}
  }

  const fallbackUsed = new Set();
  const missingAnnotations = [];
  const failed = [];
  const failPath = `/tmp/sop-capture/${area}-failures.json`;
  let captured = 0;

  try {
    const queue = [...combos];
    const attempts = new Map();
    async function worker() {
    while (queue.length) {
      const [comboKey, comboPlans] = queue.shift();
      if (done.has(comboKey) || comboPlans.every(p => done.has(`${p.screen}|${p.state}|${p.vp}`))) continue;
      const attempt = (attempts.get(comboKey) || 0) + 1; attempts.set(comboKey, attempt);
      let succeeded = false;
      const first = comboPlans[0];
      const {screen,state,vp} = first;
      if (SKIP_SCREENS.has(screen)) { console.log(`  skip (launch-gated redirect): ${comboKey}`); continue; }
      // Desktop captures render at 1440px wide (the app's desktop nav
      // breakpoint hides .ox-nav-desktop at <=1360px) then downscale to
      // 1360px wide for the published image.
      const viewport = vp === 'mobile' ? { width: 390, height: 844 } : { width: 1360, height: 900 };
      const recipe = recipeFor(first);
      const user = USERS[recipe.user || 'customer'] || null;
      const page = await H.newFixturePage(browser, {
        viewport, user, dataMode: recipe.dataMode || 'full', flags: {...(recipe.flags || {}),sopCaptureState:state},
      });
      H.attachErrorCollector(page);
      const url = recipe.url || routeForScreen(screen);
      try {
        await page.goto(`http://127.0.0.1:${port}${url}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        const s = await H.settle(page, {maxWaitMs:10000, quietWindows:1, pollMs:250});
        if (!s.mounted) throw new Error('app did not mount');
        if (recipe.actions && recipe.actions.length) {
          await H.applyActions(page, recipe.actions);
          await H.settle(page, { maxWaitMs: 8000 });
        }
        // union of annotations across plans sharing this combo
        const items = [];
        for (const p of comboPlans) {
          const planKey = `${p.guide}/${p.step}`;
          for (const a of p.ann) {
            const locator = resolveLocator(planKey, a, vp);
            if (locator !== a.locator) fallbackUsed.add(`${planKey}#${a.n}: ${a.locator} -> ${locator}`);
            items.push({ planKey, n: a.n, label: a.label, locator, guide: p.guide, step: p.step });
          }
        }
        const measured = await measureUnion(page, items, viewport);
        for (const m of measured) {
          if (!m.found) missingAnnotations.push(`${m.planKey}#${m.n} (${m.locator})`);
        }
        const errors = await H.pageErrors(page);
        const heading = await page.locator('h1').first().textContent().catch(() => null);
        const unmapped = await page.evaluate(()=>window.__sopUnmapped || []);


        // write image (first claimant's filename)
        const relDir = `${first.area}/${first.guide}`;
        const fileName = `${first.step}-${vp}.jpg`;
        const absDir = path.join(SHOTS_DIR, relDir);
        fs.mkdirSync(absDir, { recursive: true });
        const absPath = path.join(absDir, fileName);
        const tmpShot = path.join('/tmp/sop-capture', `shot-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`);
        await H.screenshotJpeg(page, tmpShot);
        let imgW = viewport.width, imgH = viewport.height;
        fs.copyFileSync(tmpShot, absPath);
        fs.unlinkSync(tmpShot);
        const src = `/sop/screenshots/${relDir}/${fileName}`;

        for (const p of comboPlans) {
          const key = `${p.guide}/${p.step}/${p.vp}`;
          manifest[key] = {
            src,
            width: imgW,
            height: imgH,
            alt: heading ? `Synthetic example: ${heading.trim()}` : p.alt,
            caption: measured.some(m=>m.planKey===`${p.guide}/${p.step}` && !m.found)
              ? 'Screen overview. Some controls described in this step are not shown in this synthetic example.'
              : p.caption || undefined,
            captureReview: { missingControls: measured.filter(m=>m.planKey===`${p.guide}/${p.step}` && !m.found).map(m=>m.label), unmapped: [...new Set(unmapped)] },
            annotations: measured
              .filter((m) => m.planKey === `${p.guide}/${p.step}` && m.found)
              .map((m) => ({ n: m.n, x: m.x, y: m.y, label: m.label })),
          };
          if (!manifest[key].caption) delete manifest[key].caption;
        }
        captured++; succeeded = true;
        const missCount = measured.filter((m) => !m.found).length;
        console.log(`  ok ${comboKey} ${missCount ? `MISSING_ANN:${missCount}` : ''} pageerr=${errors.length}`);

      } catch (e) {
        const errors = await H.pageErrors(page).catch(() => []);
        if (attempt < 2) queue.push([comboKey, comboPlans]);
        else failed.push(`${comboKey}: ${e.message} pageerrors=[${errors.slice(0, 2).join(' | ')}]`);
        console.log(`  FAIL ${comboKey}: ${e.message}`);
        fs.writeFileSync(failPath, JSON.stringify(failed, null, 1));
      } finally {
        await page.close().catch(() => {});
      }
      if (succeeded) done.add(comboKey);
      fs.writeFileSync(progressPath, JSON.stringify({ done: [...done] }));
      fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 1)+"\n");
    }
    }
    await Promise.all(Array.from({length: Number(process.env.SOP_CAPTURE_WORKERS || 4)}, () => worker()));
  } finally {
    await browser.close();
    await close();
  }

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 1) + '\n');
  console.log(`\nCaptured: ${captured}, failed: ${failed.length}`);
  if (failed.length) console.log('FAILED:\n' + failed.join('\n'));
  if (missingAnnotations.length) console.log('MISSING ANNOTATIONS:\n' + [...new Set(missingAnnotations)].join('\n'));
  if (fallbackUsed.size) console.log('FALLBACK LOCATORS:\n' + [...fallbackUsed].join('\n'));
  console.log('Manifest entries:', Object.keys(manifest).length);
  if (failed.length || missingAnnotations.length) process.exitCode = 1;
}

main().catch((e) => { console.error('CAPTURE FAILED:', e); process.exit(1); });
