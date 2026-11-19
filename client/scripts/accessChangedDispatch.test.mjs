import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Verify applicant writes reach the shared event. The projection browser check
// verifies that focus and this event actually refresh access, including when a
// read is already in flight.

const src = async (file) => readFile(new URL(`../src/${file}`, import.meta.url), 'utf8');

test('notifyAccessChanged dispatches the oxsteed:access-changed event', async () => {
  const hook = await src('hooks/useAccessProjection.js');
  assert.match(hook, /export const ACCESS_CHANGED_EVENT = 'oxsteed:access-changed'/);
  assert.match(hook, /export function notifyAccessChanged\(\)/);
  assert.match(hook, /window\.dispatchEvent\(new Event\(ACCESS_CHANGED_EVENT\)\)/);
});

test('editor submit/resubmit/save notifies through onChanged after success', async () => {
  const editor = await src('components/registration/AccessRequestEditor.jsx');
  assert.match(editor, /await accessAPI\.updateRequest\(request\.id, body, keyFor\('update'\)\)/);
  assert.match(editor, /await accessAPI\.transition\(request\.id, action, body, keyFor\(action\)\)/);
  // Success path only: the toast fires, then onChanged carries the updated
  // request to the page (which dispatches). Errors never call onChanged
  // with a request, except the version-conflict path with null.
  assert.match(editor, /toast\.success\(t\(`progressiveAccess\.toast\.\$\{action\}`/);
  assert.match(editor, /onChanged\(result\.request\)/);
});

test('Applications page dispatches on editor change and on held-access change', async () => {
  const page = await src('pages/Settings/ApplicationsPage.jsx');
  assert.match(page, /import \{ notifyAccessChanged, ACCESS_CHANGED_EVENT \} from '\.\.\/\.\.\/hooks\/useAccessProjection'/);
  // Editor success: onChanged reloads silently and dispatches.
  assert.match(page, /const onChanged = async \(\) => \{ await load\(true\); notifyAccessChanged\(\);/);
  // Approval/revocation detected on any reload dispatches too.
  assert.match(page, /notifyAccessChanged\(\);\n      \}\n      heldBeforeRef/);
  // The page also listens for the event (reviewer change while open).
  assert.match(page, /window\.addEventListener\(ACCESS_CHANGED_EVENT, refresh\)/);
});

test('signup application dispatches after an editor change', async () => {
  const signup = await src('components/registration/SignupApplication.jsx');
  assert.match(signup, /onChanged=\{\(updated\) => \{/);
  assert.match(signup, /notifyAccessChanged\(\);/);
});

test('every applicant-side access write routes through a notifying path', async () => {
  // Walk client/src for access write calls; each must live in a file whose
  // success path notifies (editor onChanged, page load/onChanged) or create
  // a draft request, which grants nothing and needs no projection refresh.
  const root = fileURLToPath(new URL('../src/', import.meta.url));
  const hits = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { await walk(path); continue; }
      if (!/\.(jsx?|tsx?)$/.test(entry.name)) continue;
      const code = await readFile(path, 'utf8');
      for (const match of code.matchAll(/accessAPI\.(transition|updateRequest|createRequest)\(/g)) {
        hits.push(`${path.slice(root.length)}:${match[1]}`);
      }
    }
  }
  await walk(root);
  assert.deepEqual(hits.sort(), [
    'components/registration/AccessRequestEditor.jsx:transition',
    'components/registration/AccessRequestEditor.jsx:updateRequest',
    'components/registration/SignupApplication.jsx:createRequest',
    'pages/Settings/ApplicationsPage.jsx:createRequest',
    'pages/Settings/ApplicationsPage.jsx:transition',
  ]);
  // The one transition that does not go through onChanged is withdraw, which
  // changes no capability: it reloads the page data right after, and the
  // reload itself dispatches if the held set ever changed.
  const page = await src('pages/Settings/ApplicationsPage.jsx');
  assert.match(page, /await accessAPI\.transition\(withdrawTarget\.id, 'withdraw'/);
  assert.match(page, /await load\(\);\n    \} catch \(err\) \{\n      toast\.error\(errorCode\(err\) === 'request_version_conflict'/);
});

// G-27: the BusinessSwitcher list used to fetch on mount only, so a member
// removed (or role-changed) elsewhere kept seeing the business until
// remount while the projection hook already refreshed. It refetches on
// focus and on the access-changed event, like useAccessProjection does.
test('BusinessSwitcher refetches on focus and on the access-changed event', async () => {
  const switcher = await src('components/BusinessSwitcher.jsx');
  assert.match(switcher, /import \{ ACCESS_CHANGED_EVENT \} from '\.\.\/hooks\/useAccessProjection'/);
  assert.match(switcher, /window\.addEventListener\('focus', refresh\)/);
  assert.match(switcher, /window\.addEventListener\(ACCESS_CHANGED_EVENT, refresh\)/);
  assert.match(switcher, /window\.removeEventListener\('focus', refresh\)/);
  assert.match(switcher, /window\.removeEventListener\(ACCESS_CHANGED_EVENT, refresh\)/);
});
