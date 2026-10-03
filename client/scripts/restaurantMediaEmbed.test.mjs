// Tests for the shared YouTube/Vimeo embed helpers used by the Learn page
// and the restaurant Media feed (client/src/utils/videoEmbed.js).
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseVideoUrl,
  toEmbedUrl,
  toAutoplayEmbedUrl,
  detectVideoProvider,
  toPosterImageUrl,
} from '../src/utils/videoEmbed.js';

test('toEmbedUrl converts YouTube watch URLs', () => {
  assert.equal(
    toEmbedUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'youtube'),
    'https://www.youtube.com/embed/dQw4w9WgXcQ',
  );
});

test('toEmbedUrl converts YouTube shorts and youtu.be URLs', () => {
  assert.equal(
    toEmbedUrl('https://www.youtube.com/shorts/abcDEF123-_', null),
    'https://www.youtube.com/embed/abcDEF123-_',
  );
  assert.equal(
    toEmbedUrl('https://youtu.be/abcDEF123-_?t=30', null),
    'https://www.youtube.com/embed/abcDEF123-_',
  );
  assert.equal(
    toEmbedUrl('https://www.youtube.com/embed/abcDEF123-_', null),
    'https://www.youtube.com/embed/abcDEF123-_',
  );
  assert.equal(
    toEmbedUrl('https://www.youtube.com/live/abcDEF123-_', null),
    'https://www.youtube.com/embed/abcDEF123-_',
  );
});

test('toEmbedUrl converts Vimeo URLs', () => {
  assert.equal(
    toEmbedUrl('https://vimeo.com/123456789', 'vimeo'),
    'https://player.vimeo.com/video/123456789',
  );
  assert.equal(
    toEmbedUrl('https://player.vimeo.com/video/123456789', null),
    'https://player.vimeo.com/video/123456789',
  );
});

test('toEmbedUrl rejects non-video and non-https URLs', () => {
  assert.equal(toEmbedUrl('https://example.com/video', null), null);
  assert.equal(toEmbedUrl('http://www.youtube.com/watch?v=dQw4w9WgXcQ', null), null);
  assert.equal(toEmbedUrl('https://www.youtube.com/watch?v=short', null), null);
  assert.equal(toEmbedUrl('not a url', null), null);
  assert.equal(toEmbedUrl(null, null), null);
  assert.equal(toEmbedUrl(42, 'youtube'), null);
});

test('provider hint resolves ambiguous hosts', () => {
  // A youtube.com URL with a vimeo hint still wins on host sniffing.
  assert.equal(detectVideoProvider('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'youtube');
  assert.equal(detectVideoProvider('https://vimeo.com/123456789'), 'vimeo');
  assert.equal(detectVideoProvider('https://example.com/x'), null);
  assert.equal(detectVideoProvider(''), null);
});

test('toAutoplayEmbedUrl appends provider autoplay params', () => {
  assert.equal(
    toAutoplayEmbedUrl('https://youtu.be/abcDEF123-_', null),
    'https://www.youtube.com/embed/abcDEF123-_?autoplay=1&mute=1&playsinline=1&rel=0',
  );
  assert.equal(
    toAutoplayEmbedUrl('https://vimeo.com/123456789', null),
    'https://player.vimeo.com/video/123456789?autoplay=1&muted=1&playsinline=1',
  );
  assert.equal(toAutoplayEmbedUrl('https://example.com/x', null), null);
});

test('toPosterImageUrl returns YouTube thumbnails, null for Vimeo', () => {
  assert.equal(
    toPosterImageUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ', null),
    'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
  );
  assert.equal(toPosterImageUrl('https://vimeo.com/123456789', null), null);
  assert.equal(toPosterImageUrl('https://example.com/x', null), null);
});

test('parseVideoUrl extracts provider and id', () => {
  assert.deepEqual(parseVideoUrl('https://youtu.be/abcDEF123-_', null), { provider: 'youtube', id: 'abcDEF123-_' });
  assert.deepEqual(parseVideoUrl('https://vimeo.com/99887766', 'vimeo'), { provider: 'vimeo', id: '99887766' });
  assert.equal(parseVideoUrl('https://example.com/', null), null);
});
