'use strict';

/**
 * Decision 8: unmounted route files are either mounted behind the shared
 * gates or deleted. Every file in server/routes must be required by index.js
 * or by another router, so a dead route file cannot sit around ungoverned.
 */
const fs = require('fs');
const path = require('path');

const SERVER = path.join(__dirname, '..');
const ROUTES = path.join(SERVER, 'routes');

// Known pre-existing unreferenced files outside decision 8's scope (not
// tenant routers that were ever mounted). Shrink this list, never grow it.
// Weekly self-audit 2026-11-04 item 13 emptied it: apiVersion and
// businessQuotes are deleted, so nothing remains allowlisted.
const KNOWN_UNREFERENCED = new Set([]);

function sources() {
  const files = [path.join(SERVER, 'index.js')];
  for (const f of fs.readdirSync(ROUTES)) if (f.endsWith('.js')) files.push(path.join(ROUTES, f));
  return files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
}

describe('decision 8: no unmounted route files', () => {
  test('the four reviewed dead route files and their orphan controllers are gone', () => {
    for (const f of ['businessExpenses', 'businessMessageTemplates', 'businessHealth', 'businessSkills']) {
      expect(fs.existsSync(path.join(ROUTES, `${f}.js`))).toBe(false);
    }
    for (const c of ['businessHealthController', 'businessTemplatesController']) {
      expect(fs.existsSync(path.join(SERVER, 'controllers', `${c}.js`))).toBe(false);
    }
  });

  test('weekly self-audit 2026-11-04 item 13: the dead batch stays deleted', () => {
    for (const f of ['apiVersion', 'businessQuotes']) {
      expect(fs.existsSync(path.join(ROUTES, `${f}.js`))).toBe(false);
    }
    for (const c of ['consultingAdminController', 'translateController']) {
      expect(fs.existsSync(path.join(SERVER, 'controllers', `${c}.js`))).toBe(false);
    }
    for (const s of ['bidCollisionDetectionService', 'bookingAbusePrevention']) {
      expect(fs.existsSync(path.join(SERVER, 'services', `${s}.js`))).toBe(false);
    }
  });

  test('the mounted routers that replace them still exist and are mounted', () => {
    const index = fs.readFileSync(path.join(SERVER, 'index.js'), 'utf8');
    for (const f of ['businessFinance', 'businessMsgTemplates', 'businessHealthAlerts', 'businesses']) {
      expect(index).toMatch(new RegExp(`require\\(['"]\\./routes/${f}['"]\\)`));
    }
  });

  test('every other route file is required by index.js or another router', () => {
    const src = sources();
    const unreferenced = fs.readdirSync(ROUTES)
      .filter((f) => f.endsWith('.js'))
      .map((f) => f.slice(0, -3))
      .filter((b) => !new RegExp(`require\\(['"]\\.{1,2}/(routes/)?${b}['"]\\)`).test(src))
      .filter((b) => !KNOWN_UNREFERENCED.has(b));
    expect(unreferenced).toEqual([]);
  });
});
