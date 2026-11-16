import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = readFileSync(join(root, 'src/App.jsx'), 'utf8');
const portal = readFileSync(join(root, 'src/pages/DirectPortalPage.jsx'), 'utf8');
const draft = readFileSync(join(root, 'src/hooks/useDirectQuoteDraft.js'), 'utf8');
const booking = readFileSync(join(root, 'src/pages/DirectBookSlotPage.jsx'), 'utf8');
const login = readFileSync(join(root, 'src/pages/Login.jsx'), 'utf8');

assert.match(app, /<Route path="\/direct\/request-quote"\s+element=\{<Guarded><DirectPortalPage view="request" \/><\/Guarded>\}/);
assert.match(app, /<Route path="\/direct\/book-slot"\s+element=\{<Guarded><DirectBookSlotPage \/><\/Guarded>\}/);
assert.match(portal, /const scope = JSON\.stringify\(\[user\?\.id \|\| null,/);
assert.match(portal, /useDirectQuoteDraft\(draftScope/);
assert.match(draft, /sessionStorage\.setItem\(key, JSON\.stringify/);
assert.match(booking, /state=\{\{ from: signInFrom \}\}/);
assert.match(login, /resolveAuthReturnPath\(returnTo \|\| location\.state\?\.from \|\| searchParams\.get\('next'\)\)/);
assert.match(login, /navigate\(from, \{ replace: true \}\)/);

console.log('progressive access Direct customer contract passed');
