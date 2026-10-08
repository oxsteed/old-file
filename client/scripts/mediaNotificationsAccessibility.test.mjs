import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'src/pages/media/MediaNotificationsPage.jsx'), 'utf8');

test('Media notification rows are keyboard operable', () => {
  assert.match(source, /role="listitem"/);
  assert.match(source, /tabIndex="0"/);
  assert.match(source, /aria-label=\{notification\.title\}/);
  assert.match(source, /event\.key === 'Enter' \|\| event\.key === ' '/);
});
