'use strict';

const express = require('express');
const request = require('supertest');
const appVersion = require('../routes/appVersion');

function buildApp() {
  const app = express();
  app.use('/api/app-version', appVersion);
  return app;
}

const ENV_KEYS = [
  'IOS_MIN_VERSION', 'IOS_LATEST_VERSION', 'IOS_UPDATE_URL', 'IOS_UPDATE_MESSAGE', 'IOS_FORCE_AFTER',
  'ANDROID_MIN_VERSION', 'ANDROID_LATEST_VERSION', 'ANDROID_UPDATE_URL', 'ANDROID_UPDATE_MESSAGE', 'ANDROID_FORCE_AFTER',
];

let saved;
beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

test('iOS returns a safe default compatibility contract when configuration is unavailable', async () => {
  const res = await request(buildApp()).get('/api/app-version/ios');
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ platform: 'ios', min_version: '1.0.0', latest_version: '1.0.0' });
  expect(res.body.update_url).toMatch(/^https:\/\/apps\.apple\.com\//);
  expect(res.body.force_after).toBeNull();
});

test('iOS exposes server-owned overrides for update prompts and force dates', async () => {
  Object.assign(process.env, {
    IOS_MIN_VERSION: '2.3.0', IOS_LATEST_VERSION: '2.4.0', IOS_UPDATE_URL: 'https://updates.example/ios',
    IOS_UPDATE_MESSAGE: 'Please update', IOS_FORCE_AFTER: '2026-12-01T00:00:00Z',
  });
  const res = await request(buildApp()).get('/api/app-version/ios');
  expect(res.body).toEqual({
    platform: 'ios', min_version: '2.3.0', latest_version: '2.4.0',
    update_url: 'https://updates.example/ios', message: 'Please update', force_after: '2026-12-01T00:00:00Z',
  });
});

test('Android returns defaults without borrowing iOS configuration', async () => {
  process.env.IOS_MIN_VERSION = '9.9.9';
  const res = await request(buildApp()).get('/api/app-version/android');
  expect(res.body).toMatchObject({ platform: 'android', min_version: '1.0.0', latest_version: '1.0.0' });
  expect(res.body.update_url).toMatch(/^https:\/\/play\.google\.com\//);
});

test('Android supports an independent server override contract', async () => {
  Object.assign(process.env, {
    ANDROID_MIN_VERSION: '3.0.0', ANDROID_LATEST_VERSION: '3.1.0',
    ANDROID_UPDATE_URL: 'https://updates.example/android', ANDROID_UPDATE_MESSAGE: 'Install the latest build',
    ANDROID_FORCE_AFTER: '2027-01-01T00:00:00Z',
  });
  const res = await request(buildApp()).get('/api/app-version/android');
  expect(res.body).toEqual({
    platform: 'android', min_version: '3.0.0', latest_version: '3.1.0',
    update_url: 'https://updates.example/android', message: 'Install the latest build', force_after: '2027-01-01T00:00:00Z',
  });
});
