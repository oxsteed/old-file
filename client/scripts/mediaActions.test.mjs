import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const card = fs.readFileSync(new URL('../src/pages/media/MediaPostCard.jsx', import.meta.url), 'utf8');

test('like, repost, and share actions reconcile viewer state with their parent', () => {
  assert.match(card, /onUpdate\?\.\(current => \(\{ \.\.\.current, liked: nextLiked, like_count: nextLikeCount \}\)\)/);
  assert.match(card, /onUpdate\?\.\(current => \(\{ \.\.\.current, reposted: nextReposted, repost_count: nextRepostCount \}\)\)/);
  assert.match(card, /onUpdate\?\.\(current => \(\{ \.\.\.current, share_count: nextShareCount \}\)\)/);
});

test('action counts use server values and safe local fallback values', () => {
  assert.match(card, /Number\.isFinite\(Number\(r\.like_count\)\)/);
  assert.match(card, /Number\.isFinite\(Number\(r\.repost_count\)\)/);
  assert.match(card, /Number\.isFinite\(Number\(result\.share_count\)\)/);
});
