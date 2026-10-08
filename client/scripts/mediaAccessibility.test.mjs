import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const postCard = fs.readFileSync(path.join(root, 'src/pages/media/MediaPostCard.jsx'), 'utf8');
const compose = fs.readFileSync(path.join(root, 'src/pages/media/MediaComposePage.jsx'), 'utf8');

test('Media video controls expose accessible labels and inline playback', () => {
  assert.match(postCard, /playsInline[^>]+aria-label=\{label\}/);
  assert.match(postCard, /className="media-video-mute"[^>]+aria-label=\{muted \? mutedLabel : unmutedLabel\}/);
});

test('Media composer exposes processing status to assistive technology', () => {
  assert.match(compose, /data-processing-status/);
  assert.match(compose, /role="status"/);
});
