'use strict';

/**
 * PS-5 regression: user-supplied media URLs (helper photo/cover/gallery,
 * business logo/cover/gallery) must be https and on the storage/CDN host
 * allowlist. The previous denylist accepted IPv4-mapped IPv6 literals,
 * trailing-dot localhost, plain http and any external host.
 */

const {
  validateMediaUrl,
  _resetAllowedHostsCache,
  _allowedHosts,
} = require('../utils/mediaUrlValidation');

const ENV_KEYS = [
  'NODE_ENV', 'S3_PUBLIC_BASE_URL', 'APP_URL', 'CLIENT_URL', 'AWS_S3_ENDPOINT', 'S3_ENDPOINT',
  'AWS_S3_BUCKET', 'S3_BUCKET', 'AWS_REGION', 'MEDIA_URL_ALLOWED_HOSTS',
];
const saved = {};

beforeEach(() => {
  for (const key of ENV_KEYS) { saved[key] = process.env[key]; delete process.env[key]; }
  process.env.NODE_ENV = 'production';
  process.env.S3_PUBLIC_BASE_URL = 'https://media.example-cdn.test/';
  process.env.APP_URL = 'https://app.example.test';
  process.env.AWS_S3_BUCKET = 'oxsteed-uploads';
  process.env.AWS_REGION = 'us-east-2';
  process.env.MEDIA_URL_ALLOWED_HOSTS = 'images.partner.test, extra.example.test';
  _resetAllowedHostsCache();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  _resetAllowedHostsCache();
});

const accept = (url) => expect(validateMediaUrl(url, 'url')).toBe(url);
const reject = (url) => expect(() => validateMediaUrl(url, 'url')).toThrow(/Invalid url/);

describe('allowlisted hosts over https are accepted', () => {
  test.each([
    'https://media.example-cdn.test/business/1/logo.webp',
    'https://app.example.test/api/storage/public/helpers/1/cover.jpg',
    'https://oxsteed-uploads.s3.us-east-2.amazonaws.com/a/b.png',
    'https://oxsteed-uploads.s3.amazonaws.com/a/b.png',
    'https://images.partner.test/x.jpg',
    'https://extra.example.test/x.jpg',
    'https://oxsteed.com/api/storage/public/x.jpg',
  ])('%s', accept);

  test('empty values pass through as null', () => {
    expect(validateMediaUrl('', 'url')).toBeNull();
    expect(validateMediaUrl(null, 'url')).toBeNull();
    expect(validateMediaUrl('   ', 'url')).toBeNull();
  });
});

describe('everything else is rejected', () => {
  test.each([
    // scheme
    'http://media.example-cdn.test/a.jpg',
    'javascript:alert(1)',
    'data:image/png;base64,AAAA',
    'file:///etc/passwd',
    'ftp://media.example-cdn.test/a.jpg',
    // non-allowlisted hosts
    'https://evil.example/a.jpg',
    'https://media.example-cdn.test.evil.example/a.jpg',
    'https://evilmedia.example-cdn.test/a.jpg',
    // loopback / private / metadata
    'https://localhost/a.jpg',
    'https://localhost./a.jpg',
    'https://127.0.0.1/a.jpg',
    'https://127.0.0.1./a.jpg',
    'https://10.0.0.1/a.jpg',
    'https://169.254.169.254/latest/meta-data',
    'https://[::1]/a.jpg',
    'https://[::ffff:127.0.0.1]/a.jpg',
    'https://[::ffff:10.0.0.1]/a.jpg',
    'https://[::ffff:a9fe:a9fe]/a.jpg',
    // the local storage route is not accepted on loopback in production
    'http://localhost:5000/api/storage/public/a.jpg',
    // garbage
    'not a url',
  ])('%s', reject);

  test('over-long URLs are rejected', () => {
    reject(`https://media.example-cdn.test/${'a'.repeat(2100)}`);
  });
});

test('trailing-dot spelling of an allowlisted host is normalised', () => {
  expect(validateMediaUrl('https://media.example-cdn.test./a.jpg', 'url')).toBe('https://media.example-cdn.test./a.jpg');
});

test('non-production accepts the local /api/storage/public route on loopback only', () => {
  process.env.NODE_ENV = 'development';
  _resetAllowedHostsCache();
  accept('http://localhost:5000/api/storage/public/helpers/1/a.jpg');
  accept('http://127.0.0.1:5000/api/storage/public/helpers/1/a.jpg');
  reject('http://localhost:5000/admin');
  reject('http://evil.example/api/storage/public/a.jpg');
});

test('allowlist is derived from env and cached per env signature', () => {
  const hosts = _allowedHosts();
  expect(hosts.has('media.example-cdn.test')).toBe(true);
  expect(hosts.has('app.example.test')).toBe(true);
  process.env.MEDIA_URL_ALLOWED_HOSTS = 'new.example.test';
  expect(_allowedHosts().has('new.example.test')).toBe(true);
  expect(_allowedHosts().has('images.partner.test')).toBe(false);
});
