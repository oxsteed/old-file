import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const card = fs.readFileSync(new URL('../src/pages/media/MediaPostCard.jsx', import.meta.url), 'utf8');
const bookmarks = fs.readFileSync(new URL('../src/pages/media/MediaBookmarksPage.jsx', import.meta.url), 'utf8');

test('bookmark changes are reported to the parent card owner', () => {
  assert.match(card, /onBookmarkChange\?\.\(post\.id, nextBookmarked\)/);
  assert.match(card, /onUpdate\?\.\(current => \(\{ \.\.\.current, bookmarked: nextBookmarked, bookmark_count: nextBookmarkCount \}\)\)/);
});

test('Saved Posts removes a card immediately after it is unsaved', () => {
  assert.match(bookmarks, /setPosts\(\(current\) => current\.filter\(\(post\) => String\(post\.id\) !== String\(postId\)\)\)/);
  assert.match(bookmarks, /onBookmarkChange=\{handleBookmarkChange\}/);
});
