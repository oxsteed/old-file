'use strict';

const policy = require('../services/mediaSafetyPolicy');
const delivery = require('../services/mediaCloudflareDelivery');

const original = {
  NODE_ENV: process.env.NODE_ENV,
  MEDIA_CSAM_MODE: process.env.MEDIA_CSAM_MODE,
  MEDIA_CSAM_CERTIFIED: process.env.MEDIA_CSAM_CERTIFIED,
  MEDIA_PUBLIC_VIDEO_INTERIM: process.env.MEDIA_PUBLIC_VIDEO_INTERIM,
  MEDIA_PUBLIC_VIDEO_WITHOUT_CSAM: process.env.MEDIA_PUBLIC_VIDEO_WITHOUT_CSAM,
  MEDIA_CLOUDFLARE_HOST: process.env.MEDIA_CLOUDFLARE_HOST,
};

afterEach(() => {
  Object.entries(original).forEach(([key, value]) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
});

test('cloudflare mode is explicit and does not imply vendor certification', () => {
  process.env.MEDIA_CSAM_MODE = 'cloudflare';
  process.env.MEDIA_CSAM_CERTIFIED = 'false';
  expect(policy.mode()).toBe('cloudflare');
  expect(policy.vendorCertified()).toBe(false);
});

test('public video is blocked unless override, vendor, or non-production interim', () => {
  process.env.MEDIA_CSAM_MODE = 'cloudflare';
  process.env.MEDIA_CSAM_CERTIFIED = 'false';
  delete process.env.MEDIA_PUBLIC_VIDEO_WITHOUT_CSAM;
  delete process.env.MEDIA_PUBLIC_VIDEO_INTERIM;
  process.env.NODE_ENV = 'production';
  expect(policy.publicVideoPublicationEnabled()).toBe(false);
  expect(policy.videoVerdictAllowed('cloudflare_deferred')).toBe(false);

  process.env.MEDIA_PUBLIC_VIDEO_WITHOUT_CSAM = 'true';
  expect(policy.publicVideoPublicationEnabled()).toBe(true);
  expect(policy.videoVerdictAllowed('cloudflare_deferred')).toBe(true);
  expect(policy.videoVerdictAllowed('public_without_csam')).toBe(true);
  expect(policy.postVerdictAllowed('public_without_csam')).toBe(true);
  expect(policy.publicVideoWithoutCsam()).toBe(true);
  expect(policy.publicVideoWithoutCsam).toBe(policy.publicVideoWithoutCsamOverride);
  expect(policy.publicPostSql('p')).toContain("'public_without_csam'");

  process.env.MEDIA_PUBLIC_VIDEO_WITHOUT_CSAM = 'false';
  expect(policy.videoVerdictAllowed('public_without_csam')).toBe(false);
  expect(policy.postVerdictAllowed('public_without_csam')).toBe(false);
  expect(policy.publicPostSql('p')).not.toContain("'public_without_csam'");
});

test('video override retains photo delivery, author verification, and rendition gates', () => {
  process.env.MEDIA_CSAM_MODE = 'cloudflare';
  process.env.NODE_ENV = 'production';
  process.env.MEDIA_PUBLIC_VIDEO_WITHOUT_CSAM = 'true';
  delete process.env.MEDIA_CLOUDFLARE_HOST;
  const sql = policy.publicPostSql('p');
  expect(sql).toContain("photo_gate.asset_type = 'image'");
  expect(sql).toContain('public_author_user.is_banned = FALSE');
  expect(sql).toContain('safety_user.is_verified = TRUE');
  expect(sql).toContain('jsonb_array_length(safety_asset.renditions) = 0');
  expect(policy.assetReady({ asset_type: 'image', processing_status: 'ready', csam_status: 'passed' })).toBe(false);
  const video = { asset_type: 'video', processing_status: 'ready', csam_status: 'public_without_csam',
    renditions: [{ storage_key: 'ready.mp4' }] };
  expect(policy.assetReady(video)).toBe(true);
  expect(policy.assetReady({ ...video, processing_status: 'quarantine' })).toBe(false);
  expect(policy.assetReady({ ...video, renditions: [] })).toBe(false);
  expect(policy.assetReady({ ...video, renditions: [{ storage_key: ' ' }] })).toBe(false);
  for (const csam_status of ['pending', 'flagged', 'unavailable']) {
    expect(policy.assetReady({ ...video, csam_status })).toBe(false);
  }
});

test('production cloudflare mode without media host blocks public photos', () => {
  process.env.MEDIA_CSAM_MODE = 'cloudflare';
  process.env.NODE_ENV = 'production';
  delete process.env.MEDIA_CLOUDFLARE_HOST;
  expect(delivery.photoDeliveryAllowed()).toBe(false);
  expect(policy.assetReady({
    asset_type: 'image',
    processing_status: 'ready',
    csam_status: 'passed',
  })).toBe(false);
  process.env.MEDIA_CLOUDFLARE_HOST = 'media.example.com';
  expect(delivery.photoDeliveryAllowed()).toBe(true);
  expect(policy.cloudflareModeMisconfigured()).toBe(false);
});

test('interim harness still cannot enable production video without override or certification', () => {
  process.env.NODE_ENV = 'production';
  process.env.MEDIA_CSAM_MODE = 'cloudflare';
  process.env.MEDIA_PUBLIC_VIDEO_INTERIM = 'true';
  process.env.MEDIA_CSAM_CERTIFIED = 'false';
  delete process.env.MEDIA_PUBLIC_VIDEO_WITHOUT_CSAM;
  expect(policy.interimHarnessAllowed()).toBe(false);
  expect(policy.publicVideoPublicationEnabled()).toBe(false);
});
