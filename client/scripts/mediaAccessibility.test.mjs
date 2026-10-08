import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const postCard = fs.readFileSync(path.join(root, 'src/pages/media/MediaPostCard.jsx'), 'utf8');
const compose = fs.readFileSync(path.join(root, 'src/pages/media/MediaComposePage.jsx'), 'utf8');
const search = fs.readFileSync(path.join(root, 'src/pages/media/MediaSearchPage.jsx'), 'utf8');

test('Media video controls expose accessible labels and inline playback', () => {
  assert.match(postCard, /playsInline[^>]+aria-label=\{label\}/);
  assert.match(postCard, /className="media-video-mute"[^>]+aria-label=\{muted \? mutedLabel : unmutedLabel\}/);
});

test('Media personal actions expose and reconcile their pressed state', () => {
  assert.match(postCard, /aria-pressed=\{reposted\}/);
  assert.match(postCard, /aria-pressed=\{liked\}/);
  assert.match(postCard, /aria-pressed=\{bookmarked\}/);
  assert.match(postCard, /setLiked\(Boolean\(post\.liked\)\)/);
  assert.match(postCard, /setBookmarked\(Boolean\(post\.bookmarked\)\)/);
  assert.match(postCard, /setReposted\(Boolean\(post\.reposted\)\)/);
});

test('Media composer exposes processing status to assistive technology', () => {
  assert.match(compose, /data-processing-status/);
  assert.match(compose, /role="status"/);
});

test('Media composer retries a restored asset when replacement media is selected', () => {
  assert.match(compose, /const handleMediaFileChange = \(event\)/);
  assert.match(compose, /setAttachedAsset\(false\)/);
  assert.match(compose, /onChange=\{handleMediaFileChange\}/);
  assert.match(compose, /const handleExternalUrlChange = \(event\)/);
});

test('Media composer persists restored draft edits before retrying publication', () => {
  assert.match(compose, /updateDraft/);
  assert.match(compose, /await updateDraft\(postId, \{ body: body\.trim\(\), links, community_id: communityId \|\| null \}\)/);
});

test('Media composer keeps polling private processing drafts until a terminal state', () => {
  assert.match(compose, /refreshProcessingDraft/);
  assert.match(compose, /setInterval\(refreshProcessingDraft, 4000\)/);
  assert.match(compose, /processingReady/);
  assert.match(compose, /clearInterval\(timer\)/);
});

test('Media search keeps account navigation inside the Media shell', () => {
  assert.match(search, /import \{ Link \} from 'react-router-dom'/);
  assert.match(search, /<Link key=\{account\.id\} to=\{`\/media\/@\$\{account\.handle\}`\}/);
  assert.doesNotMatch(search, /<a key=\{account\.id\} href=/);
});
