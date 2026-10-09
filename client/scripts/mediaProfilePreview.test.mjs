import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const preview = fs.readFileSync(path.join(root, 'src/components/media/MediaProfilePreview.jsx'), 'utf8');
const mediaApi = fs.readFileSync(path.join(root, 'src/api/media.js'), 'utf8');
const businessProfile = fs.readFileSync(path.join(root, 'src/pages/BusinessPublicProfilePage.tsx'), 'utf8');
const helperProfile = fs.readFileSync(path.join(root, 'src/pages/HelperBusinessProfilePage.tsx'), 'utf8');

test('public profiles render a bounded Media preview through the actor contract', () => {
  assert.match(preview, /getActor\(handle\)/);
  assert.match(preview, /data\?\.posts\) \? data\.posts\.slice\(0, 3\)/);
  assert.match(preview, /encodeURIComponent\(handle\)/);
  assert.match(businessProfile, /MediaProfilePreview/);
  assert.match(helperProfile, /MediaProfilePreview/);
});

test('actor handles are URL encoded before crossing the Media API boundary', () => {
  assert.match(mediaApi, /getActor = \(handle\) => api\.get\(`\/media\/actors\/\$\{encodeURIComponent\(handle\)\}`\)/);
});
