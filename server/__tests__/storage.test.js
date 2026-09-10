'use strict';

const {
  normalizeStorageContentType,
  normalizeStorageKey,
  verifyLocalDownloadSignature,
} = require('../utils/storage');

test('downgrades active browser content to a non-executable download type', () => {
  expect(normalizeStorageContentType('text/html; charset=utf-8')).toBe('application/octet-stream');
  expect(normalizeStorageContentType('application/javascript')).toBe('application/octet-stream');
  expect(normalizeStorageContentType('image/svg+xml')).toBe('application/octet-stream');
});

test('preserves safe attachment content types', () => {
  expect(normalizeStorageContentType('image/png')).toBe('image/png');
  expect(normalizeStorageContentType('application/pdf')).toBe('application/pdf');
  expect(normalizeStorageContentType('text/plain; charset=utf-8')).toBe('text/plain');
  expect(normalizeStorageContentType()).toBe('application/octet-stream');
});

test('keeps storage key normalization and signed-link validation intact', () => {
  expect(normalizeStorageKey('support-conversations/file.png')).toBe('support-conversations/file.png');
  expect(normalizeStorageKey('../private/file.png')).toBeNull();
  expect(verifyLocalDownloadSignature('support-conversations/file.png', 'not-a-number', 'bad')).toBe(false);
});
