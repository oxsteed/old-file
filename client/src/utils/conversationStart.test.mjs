import assert from 'node:assert/strict';
import test from 'node:test';
import { parseConversationStartParams, conversationStartRequestBody } from './conversationStart.js';
import { toStoredAttachment, parseInlineAttachments, isImageAttachment } from './messageAttachments.js';
import { draftStorageKey, loadMessageDraft, saveMessageDraft, clearMessageDraft } from './messageDrafts.js';

test('parseConversationStartParams accepts helperId, userId, and ownerId', () => {
  assert.deepEqual(parseConversationStartParams('?helperId=abc'), {
    helperId: 'abc',
    businessId: null,
    jobId: null,
  });
  assert.equal(parseConversationStartParams('userId=owner-9').helperId, 'owner-9');
  assert.equal(parseConversationStartParams('ownerId=7&businessId=3').businessId, '3');
  assert.equal(parseConversationStartParams('').helperId, null);
});

test('conversationStartRequestBody omits empty ids', () => {
  assert.equal(conversationStartRequestBody({ helperId: null }), null);
  assert.deepEqual(
    conversationStartRequestBody({ helperId: 'h1', businessId: '2', jobId: '9' }),
    { helperId: 'h1', businessId: '2', jobId: '9' },
  );
});

test('toStoredAttachment maps upload aliases', () => {
  assert.deepEqual(
    toStoredAttachment({ url: 'https://cdn.example/a.jpg', name: 'a.jpg', mimeType: 'image/jpeg' }),
    { url: 'https://cdn.example/a.jpg', type: 'image/jpeg', filename: 'a.jpg' },
  );
  assert.equal(toStoredAttachment({ name: 'missing-url' }), null);
  assert.equal(isImageAttachment({ type: 'image/png' }), true);
  assert.equal(isImageAttachment({ filename: 'notes.pdf' }), false);
});

test('parseInlineAttachments extracts legacy profile-chat files', () => {
  const parsed = parseInlineAttachments('See this\n[attachment:https://cdn.example/p.jpg|photo.jpg|image/jpeg]');
  assert.equal(parsed.text, 'See this');
  assert.deepEqual(parsed.attachments, [{
    url: 'https://cdn.example/p.jpg',
    filename: 'photo.jpg',
    type: 'image/jpeg',
  }]);
});

test('message drafts persist until cleared', () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
    removeItem: (key) => { store.delete(key); },
  };

  assert.equal(draftStorageKey('c1'), 'oxs:msg-draft:c1');
  saveMessageDraft('c1', 'hello there');
  assert.equal(loadMessageDraft('c1'), 'hello there');
  saveMessageDraft('c1', '   ');
  assert.equal(loadMessageDraft('c1'), '');
  saveMessageDraft('c1', 'keep me');
  clearMessageDraft('c1');
  assert.equal(loadMessageDraft('c1'), '');
});
