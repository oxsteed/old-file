import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MESSENGER_MOBILE_BREAKPOINT,
  shouldShowGuestGate,
  getMessengerPhase,
  getMessengerPhaseWithVerification,
  shouldShowLauncher,
  resolveDockLayout,
  shouldPulseLauncher,
  guestContactStorageKey,
  isValidGuestEmail,
  canContinueAsGuest,
  defaultProfileChatDestination,
  writeGuestVerifiedSession,
  readGuestVerifiedSession,
  clearGuestVerifiedSession,
  shouldConnectGuestProfileChatSocket,
  normalizeGuestLiveSocketMessage,
  shouldAppendGuestLiveMessage,
} from '../src/components/helperProfile/chat/messengerDockState.js';
import {
  buildSupportEscalationHandoff,
  readSupportEscalationHandoff,
} from '../src/components/helperProfile/chat/supportEscalationHandoff.js';
import {
  buildAvailabilityRange,
  buildBookingSlotMarker,
  buildSlotRequestMessage,
  listAvailabilityDates,
  normalizeBusinessAvailabilityPayload,
  normalizeHelperAvailabilityPayload,
  parseBookingSlotMarker,
  slotsForDate,
  toLocalDateKey,
} from '../src/components/helperProfile/chat/messengerAvailability.js';

test('shouldShowGuestGate: authenticated users never see the gate', () => {
  assert.equal(shouldShowGuestGate({ isAuthenticated: true }), false);
  assert.equal(
    shouldShowGuestGate({ isAuthenticated: true, guestContactSaved: false }),
    false,
  );
});

test('shouldShowGuestGate: guests without saved contact see the gate when allowed', () => {
  assert.equal(
    shouldShowGuestGate({ isAuthenticated: false, guestContactSaved: false }),
    true,
  );
  assert.equal(
    shouldShowGuestGate({
      isAuthenticated: false,
      guestContactSaved: true,
    }),
    false,
  );
  assert.equal(
    shouldShowGuestGate({
      isAuthenticated: false,
      guestContactSaved: false,
      allowGuestContact: false,
    }),
    false,
  );
});

test('getMessengerPhase: closed / guest_gate / thread', () => {
  assert.equal(getMessengerPhase({ dockOpen: false }), 'closed');
  assert.equal(
    getMessengerPhase({
      dockOpen: true,
      isAuthenticated: false,
      guestContactSaved: false,
    }),
    'guest_gate',
  );
  assert.equal(
    getMessengerPhase({
      dockOpen: true,
      isAuthenticated: true,
    }),
    'thread',
  );
  assert.equal(
    getMessengerPhase({
      dockOpen: true,
      isAuthenticated: false,
      guestContactSaved: true,
    }),
    'thread',
  );
});

test('shouldShowLauncher hides when dock is open', () => {
  assert.equal(shouldShowLauncher({ dockOpen: false }), true);
  assert.equal(shouldShowLauncher({ dockOpen: true }), false);
});

test('resolveDockLayout uses sheet on mobile and panel on desktop', () => {
  assert.equal(resolveDockLayout(375), 'sheet');
  assert.equal(resolveDockLayout(MESSENGER_MOBILE_BREAKPOINT - 1), 'sheet');
  assert.equal(resolveDockLayout(MESSENGER_MOBILE_BREAKPOINT), 'panel');
  assert.equal(resolveDockLayout(1440), 'panel');
});

test('shouldPulseLauncher at most once per session while closed', () => {
  assert.equal(
    shouldPulseLauncher({ dockOpen: false, hasPulsedThisSession: false }),
    true,
  );
  assert.equal(
    shouldPulseLauncher({ dockOpen: false, hasPulsedThisSession: true }),
    false,
  );
  assert.equal(
    shouldPulseLauncher({ dockOpen: true, hasPulsedThisSession: false }),
    false,
  );
});

test('guestContactStorageKey matches ChatPanel key shape', () => {
  assert.equal(
    guestContactStorageKey('42', null),
    'oxs:guest-contact:42:personal',
  );
  assert.equal(
    guestContactStorageKey('42', '99'),
    'oxs:guest-contact:42:99',
  );
});

test('isValidGuestEmail and canContinueAsGuest', () => {
  assert.equal(isValidGuestEmail('a@b.com'), true);
  assert.equal(isValidGuestEmail('nope'), false);
  assert.equal(isValidGuestEmail(''), false);
  assert.equal(canContinueAsGuest({ name: 'Ada', email: 'ada@oxsteed.com' }), true);
  assert.equal(canContinueAsGuest({ name: '  ', email: 'ada@oxsteed.com' }), false);
  assert.equal(canContinueAsGuest({ name: 'Ada', email: 'bad' }), false);
});

test('defaultProfileChatDestination is helper (provider), not oxsteed', () => {
  assert.equal(defaultProfileChatDestination(), 'helper');
});

test('buildSupportEscalationHandoff: query carries profile ids and returnTo', () => {
  const handoff = buildSupportEscalationHandoff({
    helperId: 'h-1',
    businessId: 'b-2',
    helperName: 'Ada Helper',
    returnTo: '/helpers/h-1',
    timeline: [
      { itemType: 'message', authorType: 'visitor', content: 'Need billing help' },
      { itemType: 'message', authorType: 'ai', content: 'I am an AI assistant.' },
    ],
  });
  assert.equal(handoff.pathname, '/support/escalation');
  const params = new URLSearchParams(handoff.search);
  assert.equal(params.get('from'), 'profile');
  assert.equal(params.get('helperId'), 'h-1');
  assert.equal(params.get('businessId'), 'b-2');
  assert.equal(params.get('helperName'), 'Ada Helper');
  assert.equal(params.get('returnTo'), '/helpers/h-1');
  assert.match(handoff.state.prefillMessage, /Need billing help/);
  assert.match(handoff.state.prefillMessage, /OxSteed AI/);
});

test('readSupportEscalationHandoff: merges search + state', () => {
  const parsed = readSupportEscalationHandoff({
    search: '?from=profile&helperId=h-9&returnTo=/helpers/h-9',
    state: { prefillMessage: 'Hello from dock', helperName: 'From State' },
  });
  assert.equal(parsed.isFromProfile, true);
  assert.equal(parsed.helperId, 'h-9');
  assert.equal(parsed.helperName, 'From State');
  assert.equal(parsed.returnTo, '/helpers/h-9');
  assert.equal(parsed.prefillMessage, 'Hello from dock');
});

test('readSupportEscalationHandoff: rejects non-path returnTo', () => {
  const parsed = readSupportEscalationHandoff({
    search: '?returnTo=https://evil.example',
    state: null,
  });
  assert.equal(parsed.returnTo, null);
});


test('getMessengerPhaseWithVerification: otp until verified', () => {
  assert.equal(
    getMessengerPhaseWithVerification({
      dockOpen: true,
      isAuthenticated: false,
      guestContactSaved: true,
      guestVerified: false,
    }),
    'guest_otp',
  );
  assert.equal(
    getMessengerPhaseWithVerification({
      dockOpen: true,
      isAuthenticated: false,
      guestVerified: true,
    }),
    'thread',
  );
});

test('guest verified session binds token to helper/business key', () => {
  const store = new Map();
  const storage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };
  assert.equal(
    writeGuestVerifiedSession('h1', 9, {
      guestToken: 'abc',
      sessionId: 's1',
      email: 'a@b.com',
      name: 'Ada',
      expiresInSeconds: 60,
    }, storage),
    true,
  );
  const read = readGuestVerifiedSession('h1', 9, storage);
  assert.equal(read.guestToken, 'abc');
  assert.equal(read.sessionId, 's1');
  assert.equal(readGuestVerifiedSession('h2', 9, storage), null);
  clearGuestVerifiedSession('h1', 9, storage);
  assert.equal(readGuestVerifiedSession('h1', 9, storage), null);
});


test('shouldConnectGuestProfileChatSocket requires verified guest credentials', () => {
  assert.equal(
    shouldConnectGuestProfileChatSocket({
      enabled: true,
      isGuest: true,
      guestToken: 'tok',
      guestSessionId: 'sid',
    }),
    true,
  );
  assert.equal(
    shouldConnectGuestProfileChatSocket({
      enabled: false,
      isGuest: true,
      guestToken: 'tok',
      guestSessionId: 'sid',
    }),
    false,
  );
  assert.equal(
    shouldConnectGuestProfileChatSocket({
      enabled: true,
      isGuest: false,
      guestToken: 'tok',
      guestSessionId: 'sid',
    }),
    false,
  );
  assert.equal(
    shouldConnectGuestProfileChatSocket({
      enabled: true,
      isGuest: true,
      guestToken: '',
      guestSessionId: 'sid',
    }),
    false,
  );
  assert.equal(
    shouldConnectGuestProfileChatSocket({
      enabled: true,
      isGuest: true,
      guestToken: 'tok',
      guestSessionId: 'sid',
      expiresAt: Date.now() - 1000,
      now: Date.now(),
    }),
    false,
  );
});

test('normalizeGuestLiveSocketMessage maps helper guest_chat and profile_chat events', () => {
  const fromGuestChat = normalizeGuestLiveSocketMessage(
    {
      messageId: 'm1',
      senderType: 'helper',
      senderName: 'Pat',
      message: 'Hello back',
      createdAt: '2026-09-21T12:00:00.000Z',
    },
    'guest_chat:message',
  );
  assert.equal(fromGuestChat.id, 'm1');
  assert.equal(fromGuestChat.authorType, 'helper_human');
  assert.equal(fromGuestChat.content, 'Hello back');

  assert.equal(
    normalizeGuestLiveSocketMessage(
      { messageId: 'm2', senderType: 'guest', message: 'mine' },
      'guest_chat:message',
    ),
    null,
  );

  const fromProfile = normalizeGuestLiveSocketMessage(
    {
      guestSessionId: 's1',
      message: {
        id: 'm3',
        content: 'Live reply',
        sender_type: 'helper',
        sender_name: 'Pat',
        created_at: '2026-09-21T12:01:00.000Z',
      },
    },
    'profile_chat:new_message',
  );
  assert.equal(fromProfile.id, 'm3');
  assert.equal(fromProfile.content, 'Live reply');
  assert.equal(fromProfile.authorType, 'helper_human');

  assert.equal(
    normalizeGuestLiveSocketMessage(
      { guestInquiry: true, guestSessionId: 's1', message: { content: 'from guest', sender_type: 'guest' } },
      'profile_chat:new_message',
    ),
    null,
  );
});

test('shouldAppendGuestLiveMessage dedupes by id and recent content', () => {
  const incoming = {
    id: 'm1',
    itemType: 'message',
    authorType: 'helper_human',
    content: 'Hi',
    timestamp: '2026-09-21T12:00:00.000Z',
  };
  assert.equal(shouldAppendGuestLiveMessage([], incoming), true);
  assert.equal(shouldAppendGuestLiveMessage([incoming], incoming), false);
  assert.equal(
    shouldAppendGuestLiveMessage(
      [{ ...incoming, id: 'other', timestamp: '2026-09-21T12:00:05.000Z' }],
      incoming,
    ),
    false,
  );
});


test('buildAvailabilityRange returns local YYYY-MM-DD from/to', () => {
  const now = new Date(2026, 8, 21, 15, 0, 0); // Sep 21 2026 local
  const range = buildAvailabilityRange(14, now);
  assert.equal(range.from, '2026-09-21');
  assert.equal(range.to, '2026-10-05');
  assert.equal(toLocalDateKey(now), '2026-09-21');
});

test('normalizeHelperAvailabilityPayload maps slot rows', () => {
  const { slots, hasTemplate } = normalizeHelperAvailabilityPayload({
    hasTemplate: true,
    slots: [
      { date: '2026-09-22', start: '09:00', end: '10:00', startIso: '2026-09-22T09:00:00', endIso: '2026-09-22T10:00:00' },
      { date: 'bad', start: '', end: '' },
    ],
  });
  assert.equal(hasTemplate, true);
  assert.equal(slots.length, 1);
  assert.equal(slots[0].start, '09:00');
  assert.deepEqual(listAvailabilityDates(slots), ['2026-09-22']);
  assert.equal(slotsForDate(slots, '2026-09-22').length, 1);
});

test('normalizeBusinessAvailabilityPayload maps ISO start/end', () => {
  const { slots } = normalizeBusinessAvailabilityPayload({
    service_id: 12,
    slots: [
      { start: '2026-09-22T14:00:00.000Z', end: '2026-09-22T15:00:00.000Z', staff_id: 's1' },
    ],
  });
  assert.equal(slots.length, 1);
  assert.equal(slots[0].source, 'business');
  assert.ok(slots[0].date);
  assert.ok(slots[0].start);
});

test('booking slot marker round-trip and request message', () => {
  const marker = buildBookingSlotMarker({ date: '2026-09-22', start: '09:00', end: '10:00' });
  assert.equal(marker, '[booking_slot:2026-09-22|09:00|10:00]');
  assert.deepEqual(parseBookingSlotMarker(`Please book\n${marker}`), {
    date: '2026-09-22',
    start: '09:00',
    end: '10:00',
  });
  const msg = buildSlotRequestMessage({
    date: '2026-09-22',
    start: '09:00',
    end: '10:00',
    providerName: 'Ada',
    locale: 'en',
  });
  assert.match(msg, /\[booking_slot:2026-09-22\|09:00\|10:00\]/);
  assert.match(msg, /Ada|request/i);
});
