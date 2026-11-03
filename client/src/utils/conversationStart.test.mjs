import assert from 'node:assert/strict';
import test from 'node:test';
import { parseConversationStartParams, conversationStartRequestBody } from './conversationStart.js';
import { toStoredAttachment, parseInlineAttachments, isImageAttachment } from './messageAttachments.js';
import { draftStorageKey, loadMessageDraft, saveMessageDraft, clearMessageDraft } from './messageDrafts.js';
import {
  conversationSide,
  conversationMatchesSide,
  hasHelperInboxWork,
  isGuestConversation,
} from './inboxRole.js';

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

  const key = draftStorageKey('owner', 'c1');
  store.set('oxs:msg-draft:c1', 'legacy text');
  assert.equal(loadMessageDraft(key), '');
  saveMessageDraft(key, 'hello there');
  assert.equal(loadMessageDraft(key), 'hello there');
  assert.equal(loadMessageDraft(draftStorageKey('other', 'c1')), '');
  assert.equal(loadMessageDraft(draftStorageKey('owner', 'c1', 3)), '');
  assert.equal(draftStorageKey(null, 'c1'), null);
  clearMessageDraft(key, 'older tab edit');
  assert.equal(loadMessageDraft(key), 'hello there');
  clearMessageDraft(key, 'hello there');
  assert.equal(loadMessageDraft(key), '');
  saveMessageDraft(key, 'keep me');
  saveMessageDraft(key, '   ');
  assert.equal(loadMessageDraft(key), '');
});

test('conversationSide keeps customer and helper threads distinct for dual-role users', () => {
  const me = 'user-1';
  assert.equal(conversationSide(me, { customer_id: me, helper_id: 'h1' }), 'customer');
  assert.equal(conversationSide(me, { customer_id: 'c1', helper_id: me }), 'helper');
  assert.equal(conversationSide(me, { id: 'guest-9', is_guest_inquiry: true }), 'helper');
  assert.equal(conversationSide(me, { business_id: 4, helper_id: 'other' }), 'helper');
  assert.equal(isGuestConversation({ id: 'guest-abc' }), true);
  assert.equal(conversationMatchesSide(me, { customer_id: me, helper_id: 'h1' }, 'helper'), false);
  assert.equal(conversationMatchesSide(me, { customer_id: me, helper_id: 'h1' }, 'customer'), true);
  assert.equal(hasHelperInboxWork(me, [{ helper_id: me }], false), true);
  assert.equal(hasHelperInboxWork(me, [{ customer_id: me, helper_id: 'h1' }], false), false);
});
