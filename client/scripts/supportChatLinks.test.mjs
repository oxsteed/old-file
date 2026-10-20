import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  displayRoute,
  displayRoutesInText,
  linkSegments,
  safeInternalPath,
  siteHost,
} from '../src/components/supportChatLinks.js';
import { buildGuestHandoffPrefill } from '../src/components/supportChatActionState.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const prod = { host: 'oxsteed.com' };
const links = (text, opts = prod) => linkSegments(text, opts).filter((s) => s.type !== 'text');

test('host comes from the current page, then the configured site, then oxsteed.com', () => {
  assert.equal(siteHost({ location: { host: 'staging.oxsteed.com' }, siteUrl: 'https://oxsteed.com' }), 'staging.oxsteed.com');
  assert.equal(siteHost({ location: { host: 'localhost:5173' } }), 'localhost:5173');
  assert.equal(siteHost({ location: undefined, siteUrl: 'https://preview.example.dev/' }), 'preview.example.dev');
  assert.equal(siteHost({ location: undefined, siteUrl: '' }), 'oxsteed.com');
});

test('bare routes from the screenshot display as host + path without https://', () => {
  const [job] = links('Post a Job (/post-job).');
  assert.deepEqual([job.type, job.path, job.display], ['internal', '/post-job', 'oxsteed.com/post-job']);
  const [learn] = links('Open /learn?guide=post-your-first-job');
  assert.equal(learn.display, 'oxsteed.com/learn?guide=post-your-first-job');
  assert.equal(learn.path, '/learn?guide=post-your-first-job');
  assert.equal(displayRoutesInText('Post a Job (/post-job).', prod), 'Post a Job (oxsteed.com/post-job).');
  assert.doesNotMatch(displayRoutesInText('See /wallet and https://oxsteed.com/orders', prod), /https:\/\//);
});

test('staging and dev show their own host', () => {
  assert.equal(displayRoutesInText('Go to /settings', { host: 'staging.oxsteed.com' }), 'Go to staging.oxsteed.com/settings');
  assert.equal(displayRoutesInText('Go to /settings', { host: 'localhost:5173' }), 'Go to localhost:5173/settings');
  assert.equal(displayRoute('/', 'oxsteed.com'), 'oxsteed.com');
});

test('full oxsteed.com and current-host URLs are internal (in-app), other sites stay external', () => {
  const [a, b, c] = links('Use https://oxsteed.com/wallet, https://www.oxsteed.com/orders?tab=1#x and https://example.com/help.');
  assert.deepEqual([a.type, a.path, a.display], ['internal', '/wallet', 'oxsteed.com/wallet']);
  assert.deepEqual([b.type, b.path], ['internal', '/orders?tab=1#x']);
  assert.deepEqual([c.type, c.href, c.display], ['external', 'https://example.com/help', 'https://example.com/help']);
  const [stg] = links('https://staging.oxsteed.com/jobs', { host: 'staging.oxsteed.com' });
  assert.deepEqual([stg.type, stg.display], ['internal', 'staging.oxsteed.com/jobs']);
  // Another subdomain on a production page is a different site.
  assert.equal(links('https://status.oxsteed.com/')[0].type, 'external');
  const [bare] = links('Visit oxsteed.com/post-job today');
  assert.deepEqual([bare.type, bare.path, bare.display], ['internal', '/post-job', 'oxsteed.com/post-job']);
});

test('guards: fractions, words, emails, protocol-relative paths', () => {
  assert.deepEqual(links('Split 50/50 and/or 24/7'), []);
  assert.deepEqual(links('write to help@oxsteed.com'), []);
  assert.equal(safeInternalPath('//evil.example/x'), '/evil.example/x');
  const [p] = links('https://oxsteed.com//evil.example/x');
  assert.equal(p.path, '/evil.example/x');
  assert.ok(!p.path.startsWith('//'));
  assert.deepEqual(links('just / alone'), []);
  // Trailing punctuation stays outside the link.
  assert.deepEqual(linkSegments('(/jobs).', prod).map((s) => s.text || s.path), ['(', '/jobs', ').']);
});

test('guest handoff transcript shows routes as full addresses', () => {
  const text = buildGuestHandoffPrefill([
    { role: 'assistant', content: 'Hi' },
    { role: 'user', content: 'how do I post?' },
    { role: 'assistant', content: 'Use Post a Job (/post-job).' },
  ], { header: '[AI]', pageLabel: 'الصفحة: {{page}}', page: '/my-jobs', host: 'oxsteed.com' });
  assert.match(text, /الصفحة: oxsteed\.com\/my-jobs/);
  assert.match(text, /Ox: Use Post a Job \(oxsteed\.com\/post-job\)\./);
});

test('widget wiring: bidi-isolated link text, in-app navigation, nudges, action cards, transcripts', async () => {
  const src = await readFile(join(root, 'src/components/SupportWidget.jsx'), 'utf8');
  assert.match(src, /<bdi dir="ltr">\{children\}<\/bdi>/);
  assert.match(src, /linkSegments\(text, \{ host: siteHost\(\) \}\)/);
  assert.match(src, /if \(onInternalNav\) onInternalNav\(seg\.path\)/);
  assert.match(src, /target="_blank" rel="noopener noreferrer"/);
  assert.match(src, /<RouteLink path=\{m\.nudge\.path\} onNav=\{navigate\} \/>/);
  assert.match(src, /displayRoute\(m\.action\.display\.path, siteHost\(\)\)/);
  assert.match(src, /displayRoutesInText\(m\.content \|\| '', \{ host: siteHost\(\) \}\)/);
  assert.match(src, /host: siteHost\(\),/);
});

test('prompt asks for bare routes in parentheses and no domains', async () => {
  const guide = await readFile(join(root, '../server/services/assistantGuide.js'), 'utf8');
  assert.match(guide, /Post a Job \(\/post-job\)/);
  assert.match(guide, /Never add a domain, https:\/\/ or a full URL for OxSteed pages/);
  assert.doesNotMatch(guide, /Use page names followed by paths/);
});
