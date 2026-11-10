'use strict';

/**
 * Security review 2026-11-10 F-03: stored uploads must never be rendered as
 * HTML or script from the app origin, whatever the uploader named them.
 */

const express = require('express');
const request = require('supertest');
const { Readable } = require('stream');
const storage = require('../utils/storage');
const {
  sniffContentType, safeKeyExtension, resolveServedType,
} = require('../utils/storageContentSafety');

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL+AAAAAElFTkSuQmCC',
  'base64'
);
const HTML = Buffer.from('<!doctype html><script>alert(document.domain)</script>');

function storageApp() {
  const a = express();
  a.use('/api/storage', require('../routes/storage'));
  return a;
}

describe('key extensions', () => {
  test('come from the detected type, not the uploader name', () => {
    expect(safeKeyExtension('x.html', PNG)).toBe('.png');
    expect(safeKeyExtension('y.js', PNG)).toBe('.png');
    expect(safeKeyExtension('evil.svg', HTML)).toBe('');
    expect(safeKeyExtension('page.html', HTML)).toBe('');
    // A media extension without matching bytes is dropped, a benign
    // document extension is kept.
    expect(safeKeyExtension('fake.png', HTML)).toBe('');
    expect(safeKeyExtension('report.docx', Buffer.from('PK\u0003\u0004'))).toBe('.docx');
    expect(safeKeyExtension('notes.TXT', Buffer.from('hello'))).toBe('.txt');
  });

  test('uploadFile never stores a key ending in an active extension', async () => {
    const key = await storage.uploadFile(PNG, 'helper-covers', 'x.html', 'image/png');
    expect(key).toMatch(/^helper-covers\/[0-9a-f]{32}\.png$/);
    const htmlKey = await storage.uploadFile(HTML, 'helper-covers', 'x.html', 'image/png');
    expect(htmlKey).toMatch(/^helper-covers\/[0-9a-f]{32}$/);
  });
});

describe('served headers', () => {
  test('a PNG is inline image/png with nosniff and a sandbox CSP', async () => {
    const key = await storage.uploadFile(PNG, 'helper-covers', 'x.html', 'image/png');
    const res = await request(storageApp()).get(`/api/storage/public/${key}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^image\/png/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toMatch(/sandbox/);
    expect(res.headers['content-disposition']).toMatch(/^inline/);
  });

  test('HTML bytes uploaded as an "image" are an octet-stream attachment', async () => {
    const key = await storage.uploadFile(HTML, 'helper-covers', 'x.html', 'image/png');
    const res = await request(storageApp()).get(`/api/storage/public/${key}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/octet-stream/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-disposition']).toMatch(/^attachment/);
  });

  test('a legacy key ending in .html is never served as text/html', async () => {
    const key = 'helper-covers/legacyattack.html';
    await storage.uploadFile(key, HTML, 'text/html');
    const res = await request(storageApp()).get(`/api/storage/public/${key}`);
    expect(res.headers['content-type']).not.toMatch(/html/);
    expect(res.headers['content-disposition']).toMatch(/^attachment/);
  });

  test('remote objects are typed from their first bytes, not the key', () => {
    expect(resolveServedType({ buffer: HTML, key: 'helper-covers/a.html' }))
      .toEqual({ contentType: 'application/octet-stream', inline: false });
    expect(resolveServedType({ buffer: HTML, key: 'helper-covers/a.png' }))
      .toEqual({ contentType: 'application/octet-stream', inline: false });
    expect(resolveServedType({ buffer: PNG, key: 'helper-covers/a.js' }))
      .toEqual({ contentType: 'image/png', inline: true });
    expect(resolveServedType({ buffer: Buffer.from('a,b\n1,2'), key: 'x/a.csv' }))
      .toEqual({ contentType: 'text/csv', inline: false });
  });

  test('the remote public route sniffs the stream and streams it unchanged', async () => {
    jest.resetModules();
    process.env.AWS_S3_ENDPOINT = 'https://r2.example.test';
    jest.doMock('../utils/storage', () => ({
      ...jest.requireActual('../utils/storage'),
      getObjectStream: jest.fn(async () => Readable.from([HTML.subarray(0, 10), HTML.subarray(10)])),
    }));
    try {
      const a = express();
      a.use('/api/storage', require('../routes/storage'));
      const res = await request(a).get('/api/storage/public/helper-covers/abc.html').buffer(true)
        .parse((r, cb) => { const c = []; r.on('data', (d) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); });
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/^application\/octet-stream/);
      expect(res.headers['content-disposition']).toBe('attachment');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(Buffer.compare(res.body, HTML)).toBe(0);
    } finally {
      delete process.env.AWS_S3_ENDPOINT;
      jest.dontMock('../utils/storage');
    }
  });
});

test('sniffing recognises the media we accept', () => {
  expect(sniffContentType(PNG)).toBe('image/png');
  expect(sniffContentType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe('image/jpeg');
  expect(sniffContentType(Buffer.from('%PDF-1.7\n'))).toBe('application/pdf');
  expect(sniffContentType(HTML)).toBeNull();
});
