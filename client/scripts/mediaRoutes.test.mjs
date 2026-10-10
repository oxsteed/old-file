import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { matchRoutes } from 'react-router-dom';

const source = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const shellSource = fs.readFileSync(new URL('../src/pages/media/MediaShell.jsx', import.meta.url), 'utf8');
const routes = [...source.matchAll(/<Route path="(\/media[^\"]*)"[^\n]*element=\{([^\n]*)/g)]
  .map(([, path, element]) => ({ path, element }));

test('real Media routes resolve public @handles and keep every static page ahead of the actor route', () => {
  const matched = url => matchRoutes(routes, url)?.at(-1);
  assert.match(matched('/media/@local-helper').route.element, /MediaActorPage/);
  assert.equal(matched('/media/@local-helper').params.handle, '@local-helper');
  assert.match(matched('/media/verify-identity').route.element, /VerifyIdentityPage embedded/);
  assert.match(matched('/media/verify-identity').route.element, /ProtectedRoute requireOnboarded=\{false\}/);
  for (const [url, page] of [['/media','MediaFeedPage'],['/media/search','MediaSearchPage'],['/media/creator','MediaCreatorPage'],['/media/messages','MediaMessagesPage'],['/media/notifications','MediaNotificationsPage'],['/media/verification','MediaVerificationPage'],['/media/bookmarks','MediaBookmarksPage'],['/media/compose','MediaComposePage'],['/media/communities','MediaCommunitiesPage'],['/media/communities/local','MediaCommunityPage'],['/media/post/123','MediaPostDetailPage']]) {
    assert.match(matched(url).route.element, new RegExp(page), url);
  }
});

test('Media shell replaces stale titles for pages without page-level metadata', () => {
  assert.match(shellSource, /currentPath === '\/media\/creator'\s*\? t\('media\.creator\.title'\)/);
  assert.match(shellSource, /<PageMeta title=\{mediaMetaTitle\} \/>/);
});
