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
