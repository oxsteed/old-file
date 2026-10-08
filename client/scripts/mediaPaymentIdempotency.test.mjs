import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const api = fs.readFileSync(new URL('../src/api/media.js', import.meta.url), 'utf8');
const creator = fs.readFileSync(new URL('../src/pages/media/MediaCreatorPage.jsx', import.meta.url), 'utf8');
const card = fs.readFileSync(new URL('../src/pages/media/MediaPostCard.jsx', import.meta.url), 'utf8');

test('creator payment APIs move idempotency keys to request headers', () => {
  assert.match(api, /createCreatorTip[\s\S]*headers: idempotencyKey \? \{ 'Idempotency-Key': idempotencyKey \}/);
  assert.match(api, /createCreatorBoost[\s\S]*headers: idempotencyKey \? \{ 'Idempotency-Key': idempotencyKey \}/);
});

test('tip and sponsorship retries reuse the key created when support opens', () => {
  assert.match(creator, /idempotencyKey: supportIdempotencyKey/);
  assert.match(creator, /setSupportIdempotencyKey\(`media-\$\{mode\}-\$\{gig\.id\}-/);
  assert.doesNotMatch(creator, /idempotencyKey: `media-tip-\$\{supportTarget\.id\}-\$\{Date\.now\(\)\}`/);
});

test('boost retries reuse the key created when the boost dialog opens', () => {
  assert.match(card, /idempotencyKey: boostIdempotencyKey/);
  assert.match(card, /setBoostIdempotencyKey\(`media-boost-\$\{post\.id\}-\$\{Date\.now\(\)\}/);
  assert.doesNotMatch(card, /idempotencyKey: `media-boost-\$\{post\.id\}-\$\{Date\.now\(\)\}`/);
});
