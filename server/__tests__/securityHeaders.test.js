'use strict';

const express = require('express');
const request = require('supertest');

function loadHeaders(env) {
  let middleware;
  let imageSourceList;
  jest.isolateModules(() => {
    const previous = {};
    for (const key of Object.keys(env)) {
      previous[key] = process.env[key];
      process.env[key] = env[key];
    }
    const securityHeaders = require('../middleware/securityHeaders');
    middleware = securityHeaders;
    imageSourceList = securityHeaders.imageSourceList;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  return { middleware, imageSourceList };
}

test('img-src keeps first-party storage hosts and drops the https wildcard', () => {
  const { imageSourceList } = loadHeaders({
    AWS_S3_BUCKET: 'oxsteed-media',
    AWS_REGION: 'us-east-1',
    S3_PUBLIC_BASE_URL: 'https://cdn.oxsteed.test/assets/',
  });
  const sources = imageSourceList({
    AWS_S3_BUCKET: 'oxsteed-media',
    AWS_REGION: 'us-east-1',
    S3_PUBLIC_BASE_URL: 'https://cdn.oxsteed.test/assets/',
  });
  expect(sources).toEqual(expect.arrayContaining([
    "'self'",
    'data:',
    'blob:',
    'https://images.unsplash.com',
    'https://tiles.geo.us-east-1.amazonaws.com',
    'https://oxsteed-media.s3.us-east-1.amazonaws.com',
    'https://oxsteed-media.s3.amazonaws.com',
    'https://oxsteed-media.s3-us-east-1.amazonaws.com',
    'https://cdn.oxsteed.test',
  ]));
  expect(sources).not.toContain('https:');
});

test('img-src ignores a non-https public base and an unset bucket', () => {
  const { imageSourceList } = loadHeaders({});
  const sources = imageSourceList({
    S3_PUBLIC_BASE_URL: 'http://cdn.oxsteed.test',
  });
  expect(sources.some((source) => source.includes('s3.'))).toBe(false);
  expect(sources).not.toContain('http://cdn.oxsteed.test');
  expect(sources).not.toContain('https:');
});

test('the CSP header allows the configured bucket and public origin', async () => {
  const { middleware } = loadHeaders({
    AWS_S3_BUCKET: 'oxsteed-media',
    AWS_REGION: 'us-west-2',
    S3_PUBLIC_BASE_URL: 'https://cdn.oxsteed.test/assets',
  });
  const app = express();
  app.use(middleware);
  app.get('/', (_req, res) => res.send('ok'));
  const res = await request(app).get('/');
  const csp = res.headers['content-security-policy'];
  const imgSrc = csp.split(';').map((part) => part.trim()).find((part) => part.startsWith('img-src'));
  expect(imgSrc).toContain('https://oxsteed-media.s3.us-west-2.amazonaws.com');
  expect(imgSrc).toContain('https://cdn.oxsteed.test');
  expect(imgSrc).not.toMatch(/(?:^|\s)https:(?:\s|$)/);
});
