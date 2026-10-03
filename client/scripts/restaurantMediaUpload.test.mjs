// Tests for restaurant Media device uploads (client/src/utils/restaurantMediaUpload.js)
// and the upload i18n subtree. Covers modal tab config, client-side
// size/MIME rejection, XHR progress wiring (mocked), photo card URL
// resolution, video rendition selection (720p preferred), the 202
// processing outcome, and upload error states.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  MEDIA_UPLOAD_TABS,
  PHOTO_MAX_BYTES,
  VIDEO_MAX_BYTES,
  PHOTO_MIME_ALLOWLIST,
  VIDEO_MIME_ALLOWLIST,
  UPLOAD_ENDPOINTS,
  validateUploadFile,
  isPhotoUpload,
  isVideoUpload,
  isUploadItem,
  pickBestRendition,
  uploadedMediaUrl,
  uploadOutcome,
  formatFileSize,
  uploadMediaWithProgress,
} from '../src/utils/restaurantMediaUpload.js';

const root = path.resolve(import.meta.dirname, '..');
const catalog = (lang) => JSON.parse(fs.readFileSync(path.join(root, `src/locales/${lang}.json`), 'utf8'));
const LANGUAGES = ['en', 'es', 'fr', 'ht', 'ar'];
const uploadCopy = (lang) => catalog(lang).food.restaurant.media.upload;

const fileLike = (size, type) => ({ size, type, name: 'test.bin' });

// ── Modal tabs ───────────────────────────────────────────────────────────────

test('upload modal offers exactly the Link | Photo | Video tabs, in order', () => {
  assert.deepEqual(MEDIA_UPLOAD_TABS, ['link', 'photo', 'video']);
});

test('tab labels are translated in all five locales', () => {
  for (const lang of LANGUAGES) {
    const tabs = uploadCopy(lang).tabs;
    for (const key of MEDIA_UPLOAD_TABS) {
      assert.equal(typeof tabs[key], 'string', `${lang}: tabs.${key} missing`);
      assert.ok(tabs[key].trim().length > 0, `${lang}: tabs.${key} empty`);
    }
  }
});

// ── Size caps and MIME allowlists ────────────────────────────────────────────

test('upload size caps match the server contract (10 MB photo / 200 MB video)', () => {
  assert.equal(PHOTO_MAX_BYTES, 10 * 1024 * 1024);
  assert.equal(VIDEO_MAX_BYTES, 200 * 1024 * 1024);
  assert.deepEqual(UPLOAD_ENDPOINTS, { photo: 'photo-uploads', video: 'video-uploads' });
});

test('photo allowlist covers common image types only', () => {
  assert.deepEqual([...PHOTO_MIME_ALLOWLIST].sort(), ['image/gif', 'image/jpeg', 'image/png', 'image/webp']);
  assert.deepEqual([...VIDEO_MIME_ALLOWLIST].sort(), ['video/mp4', 'video/quicktime', 'video/webm']);
});

test('validateUploadFile accepts in-cap, allowlisted files', () => {
  assert.deepEqual(validateUploadFile(fileLike(5 * 1024 * 1024, 'image/jpeg'), 'photo'), { ok: true });
  assert.deepEqual(validateUploadFile(fileLike(PHOTO_MAX_BYTES, 'image/webp'), 'photo'), { ok: true });
  assert.deepEqual(validateUploadFile(fileLike(100 * 1024 * 1024, 'video/mp4'), 'video'), { ok: true });
  assert.deepEqual(validateUploadFile(fileLike(VIDEO_MAX_BYTES, 'video/quicktime'), 'video'), { ok: true });
  // MIME matching is case-insensitive.
  assert.deepEqual(validateUploadFile(fileLike(1024, 'IMAGE/PNG'), 'photo'), { ok: true });
});

test('validateUploadFile rejects oversized files before anything is sent', () => {
  assert.deepEqual(
    validateUploadFile(fileLike(PHOTO_MAX_BYTES + 1, 'image/jpeg'), 'photo'),
    { ok: false, error: 'fileTooLarge' },
  );
  assert.deepEqual(
    validateUploadFile(fileLike(VIDEO_MAX_BYTES + 1, 'video/mp4'), 'video'),
    { ok: false, error: 'fileTooLarge' },
  );
});

test('validateUploadFile rejects disallowed MIME types', () => {
  assert.deepEqual(
    validateUploadFile(fileLike(1024, 'application/pdf'), 'photo'),
    { ok: false, error: 'fileTypeNotAllowed' },
  );
  // Cross-kind mismatch: a video is not a valid photo upload.
  assert.deepEqual(
    validateUploadFile(fileLike(1024, 'video/mp4'), 'photo'),
    { ok: false, error: 'fileTypeNotAllowed' },
  );
  assert.deepEqual(
    validateUploadFile(fileLike(1024, 'image/jpeg'), 'video'),
    { ok: false, error: 'fileTypeNotAllowed' },
  );
});

test('validateUploadFile rejects missing or empty files', () => {
  assert.deepEqual(validateUploadFile(null, 'photo'), { ok: false, error: 'fileTypeNotAllowed' });
  assert.deepEqual(validateUploadFile(undefined, 'video'), { ok: false, error: 'fileTypeNotAllowed' });
  assert.deepEqual(validateUploadFile(fileLike(0, 'image/jpeg'), 'photo'), { ok: false, error: 'fileTypeNotAllowed' });
  assert.deepEqual(validateUploadFile(fileLike(1024, ''), 'photo'), { ok: false, error: 'fileTypeNotAllowed' });
});

test('validation error codes map to localized copy in all five locales', () => {
  for (const lang of LANGUAGES) {
    const copy = uploadCopy(lang);
    assert.ok(copy.fileTooLarge.trim().length > 0, `${lang}: fileTooLarge`);
    assert.ok(copy.fileTypeNotAllowed.trim().length > 0, `${lang}: fileTypeNotAllowed`);
    assert.ok(copy.uploadFailed.trim().length > 0, `${lang}: uploadFailed`);
  }
});

// ── XHR progress wiring (mocked XMLHttpRequest) ──────────────────────────────

const instances = [];
class FakeXHR {
  constructor() {
    this.upload = {};
    this.headers = {};
    instances.push(this);
  }
  open(method, url) { this.method = method; this.url = url; }
  setRequestHeader(name, value) { this.headers[name] = value; }
  send(form) { this.form = form; }
}
const lastInstance = () => instances[instances.length - 1];
const fakeForm = () => ({ append() {} });

test('upload progress events drive the onProgress fraction', async () => {
  const seen = [];
  const pending = uploadMediaWithProgress({
    url: 'https://api.test/restaurants/1/media/photo-uploads',
    formData: fakeForm(),
    headers: { Authorization: 'Bearer token123' },
    onProgress: (fraction) => seen.push(fraction),
    XHR: FakeXHR,
  });
  const xhr = lastInstance();
  assert.equal(xhr.method, 'POST');
  assert.equal(xhr.url, 'https://api.test/restaurants/1/media/photo-uploads');
  assert.equal(xhr.headers.Authorization, 'Bearer token123');

  xhr.upload.onprogress({ lengthComputable: true, loaded: 25, total: 100 });
  xhr.upload.onprogress({ lengthComputable: true, loaded: 100, total: 100 });
  // Non-computable events are ignored, never NaN.
  xhr.upload.onprogress({ lengthComputable: false, loaded: 50, total: 0 });

  xhr.status = 201;
  xhr.responseText = JSON.stringify({ media: { id: 'm1', media_type: 'photo_upload' } });
  xhr.onload();

  const result = await pending;
  assert.deepEqual(seen, [0.25, 1]);
  assert.equal(result.status, 201);
  assert.equal(result.outcome, 'ready');
  assert.equal(result.item.id, 'm1');
});

test('202 resolves as processing (quarantined video)', async () => {
  const pending = uploadMediaWithProgress({ url: 'u', formData: fakeForm(), XHR: FakeXHR });
  const xhr = lastInstance();
  xhr.status = 202;
  xhr.responseText = JSON.stringify({ id: 'v1', media_type: 'video_upload', processing_status: 'quarantine' });
  xhr.onload();
  const result = await pending;
  assert.equal(result.status, 202);
  assert.equal(result.outcome, 'processing');
  assert.equal(result.item.id, 'v1');
});

test('malformed JSON body on success still resolves with a null item', async () => {
  const pending = uploadMediaWithProgress({ url: 'u', formData: fakeForm(), XHR: FakeXHR });
  const xhr = lastInstance();
  xhr.status = 201;
  xhr.responseText = 'not json';
  xhr.onload();
  const result = await pending;
  assert.equal(result.outcome, 'ready');
  assert.equal(result.item, null);
});

test('non-2xx rejects with an axios-shaped error carrying the server code', async () => {
  const pending = uploadMediaWithProgress({ url: 'u', formData: fakeForm(), XHR: FakeXHR });
  const xhr = lastInstance();
  xhr.status = 413;
  xhr.responseText = JSON.stringify({ code: 'media_too_large' });
  xhr.onload();
  await assert.rejects(pending, (err) => {
    assert.equal(err.code, 'media_too_large');
    // Shape the existing mediaErrorCode mapper reads: err.response.data.code.
    assert.equal(err.response.data.code, 'media_too_large');
    assert.equal(err.response.status, 413);
    return true;
  });
});

test('network failure rejects with the network code', async () => {
  const pending = uploadMediaWithProgress({ url: 'u', formData: fakeForm(), XHR: FakeXHR });
  lastInstance().onerror();
  await assert.rejects(pending, (err) => {
    assert.equal(err.code, 'network');
    return true;
  });
});

test('missing XMLHttpRequest rejects instead of hanging', async () => {
  assert.equal(typeof globalThis.XMLHttpRequest, 'undefined', 'node has no XHR; test premise');
  await assert.rejects(
    uploadMediaWithProgress({ url: 'u', formData: fakeForm(), XHR: null }),
    (err) => {
      assert.equal(err.code, 'upload_unsupported');
      return true;
    },
  );
});

// ── Photo card URL resolution ────────────────────────────────────────────────

test('upload item type guards', () => {
  assert.equal(isPhotoUpload({ media_type: 'photo_upload' }), true);
  assert.equal(isPhotoUpload({ media_type: 'video_upload' }), false);
  assert.equal(isPhotoUpload({ media_type: 'video_link' }), false);
  assert.equal(isPhotoUpload({}), false);
  assert.equal(isPhotoUpload(null), false);
  assert.equal(isVideoUpload({ media_type: 'video_upload' }), true);
  assert.equal(isVideoUpload({ media_type: 'photo_upload' }), false);
  assert.equal(isUploadItem({ media_type: 'video_link' }), false);
  assert.equal(isUploadItem({ media_type: 'photo_upload' }), true);
});

test('photo card renders from url, falling back to thumbnail_url', () => {
  assert.equal(
    uploadedMediaUrl({ media_type: 'photo_upload', url: 'https://cdn/u.jpg', thumbnail_url: 'https://cdn/t.jpg' }),
    'https://cdn/u.jpg',
  );
  assert.equal(
    uploadedMediaUrl({ media_type: 'photo_upload', thumbnail_url: 'https://cdn/t.jpg' }),
    'https://cdn/t.jpg',
  );
  assert.equal(uploadedMediaUrl({ media_type: 'photo_upload' }), null);
});

test('link rows never resolve to an upload URL', () => {
  assert.equal(uploadedMediaUrl({ media_type: 'video_link', video_url: 'https://youtu.be/x' }), null);
  assert.equal(uploadedMediaUrl({}), null);
});

// ── Video rendition selection (720p preferred) ───────────────────────────────

test('pickBestRendition prefers an exact 720p rendition', () => {
  const renditions = [
    { url: 'https://cdn/1080.mp4', width: 1920, height: 1080 },
    { url: 'https://cdn/480.mp4', width: 854, height: 480 },
    { url: 'https://cdn/720.mp4', width: 1280, height: 720 },
  ];
  assert.equal(pickBestRendition(renditions).url, 'https://cdn/720.mp4');
});

test('without 720p, the closest height wins', () => {
  const renditions = [
    { url: 'https://cdn/1080.mp4', width: 1920, height: 1080 },
    { url: 'https://cdn/480.mp4', width: 854, height: 480 },
  ];
  // |480-720| = 240 < |1080-720| = 360.
  assert.equal(pickBestRendition(renditions).url, 'https://cdn/480.mp4');
});

test('height ties go to the smaller rendition (less bandwidth)', () => {
  const renditions = [
    { url: 'https://cdn/1080.mp4', width: 1920, height: 1080 },
    { url: 'https://cdn/360.mp4', width: 640, height: 360 },
  ];
  assert.equal(pickBestRendition(renditions).url, 'https://cdn/360.mp4');
});

test('pickBestRendition is defensive about bad input', () => {
  assert.equal(pickBestRendition([]), null);
  assert.equal(pickBestRendition(null), null);
  assert.equal(pickBestRendition(undefined), null);
  assert.equal(pickBestRendition([{ width: 100, height: 720 }]), null);
  assert.equal(pickBestRendition([{ url: 'x', width: 100 }]), null);
  // String heights still work.
  assert.equal(pickBestRendition([{ url: 'x', height: '720' }]).url, 'x');
});

test('video upload card uses the best rendition url, falling back to url', () => {
  const media = {
    media_type: 'video_upload',
    url: 'https://cdn/orig.mp4',
    renditions: [
      { url: 'https://cdn/480.mp4', width: 854, height: 480 },
      { url: 'https://cdn/720.mp4', width: 1280, height: 720 },
    ],
  };
  assert.equal(uploadedMediaUrl(media), 'https://cdn/720.mp4');
  assert.equal(
    uploadedMediaUrl({ media_type: 'video_upload', url: 'https://cdn/orig.mp4' }),
    'https://cdn/orig.mp4',
  );
});

// ── Upload outcome + processing notice copy ──────────────────────────────────

test('uploadOutcome maps 201 to ready and 202 to processing', () => {
  assert.equal(uploadOutcome(201), 'ready');
  assert.equal(uploadOutcome(202), 'processing');
  assert.equal(uploadOutcome(200), 'unknown');
  assert.equal(uploadOutcome(500), 'unknown');
});

test('processing notice copy is present, non-empty, and em-dash free in all locales', () => {
  for (const lang of LANGUAGES) {
    const notice = uploadCopy(lang).processingNotice;
    for (const key of ['title', 'body', 'failedHint', 'refresh', 'dismiss']) {
      assert.equal(typeof notice[key], 'string', `${lang}: processingNotice.${key} missing`);
      assert.ok(notice[key].trim().length > 0, `${lang}: processingNotice.${key} empty`);
      assert.ok(!notice[key].includes('—'), `${lang}: em dash in processingNotice.${key}`);
    }
    // Honest copy: the body says the video will appear "soon", never that
    // it is visible now (quarantined videos never hit the public list).
    assert.ok(
      /soon|pronto|bient[oô]t|byento|قريب/.test(notice.body),
      `${lang}: body should say the video appears soon`,
    );
  }
});

test('photo success and photo alt copy exist in all locales', () => {
  for (const lang of LANGUAGES) {
    const copy = uploadCopy(lang);
    assert.ok(copy.postedPhoto.trim().length > 0, `${lang}: postedPhoto`);
    assert.ok(copy.viewPhoto.trim().length > 0, `${lang}: viewPhoto`);
    assert.ok(copy.submitFile.trim().length > 0, `${lang}: submitFile`);
    assert.ok(copy.uploading.trim().length > 0, `${lang}: uploading`);
  }
});

// ── Misc ─────────────────────────────────────────────────────────────────────

test('formatFileSize renders short MB labels', () => {
  assert.equal(formatFileSize(0), '0.0 MB');
  assert.equal(formatFileSize(5 * 1024 * 1024), '5.0 MB');
  assert.equal(formatFileSize(15 * 1024 * 1024), '15 MB');
  assert.equal(formatFileSize(NaN), '');
});
