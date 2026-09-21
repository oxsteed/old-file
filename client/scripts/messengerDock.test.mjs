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
  canVisitorLive,
  isOxsteedDestinationLiveAgent,
  resolveAiFailureFromServer,
  resolveAiFailureRouting,
  resolveProviderPresenceTransition,
} from '../src/components/helperProfile/chat/profileChatRouting.js';
import {
  buildAvailabilityRange,
  buildBookingSlotMarker,
  buildMessengerBookingPayload,
  buildSlotConfirmationContent,
  buildSlotRequestMessage,
  filterBookableServices,
  listAvailabilityDates,
  normalizeBusinessAvailabilityPayload,
  normalizeHelperAvailabilityPayload,
  parseBookingSlotMarker,
  pickDefaultBookableService,
  resolveClientTimezone,
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
    serviceId: null,
    serviceName: '',
    timezone: '',
  });
  const msg = buildSlotRequestMessage({
    date: '2026-09-22',
    start: '09:00',
    end: '10:00',
    providerName: 'Ada',
    locale: 'en',
  });
  assert.match(msg, /\[booking_slot:2026-09-22\|09:00\|10:00/);
  assert.match(msg, /Ada|request/i);
});


test('filterBookableServices keeps active online-bookable rows', () => {
  const bookable = filterBookableServices([
    { id: 1, name: 'Cut', allow_online_booking: true, is_active: true },
    { id: 2, name: 'Hidden', allow_online_booking: false, is_active: true },
    { id: 3, name: 'Inactive', allow_online_booking: true, is_active: false },
    { id: 4, title: 'Color', allow_online_booking: true },
  ]);
  assert.equal(bookable.length, 2);
  assert.equal(bookable[0].name, 'Cut');
  assert.equal(pickDefaultBookableService(bookable).id, 1);
});

test('extended booking marker round-trip includes service and timezone', () => {
  const marker = buildBookingSlotMarker({
    date: '2026-09-22',
    start: '09:00',
    end: '10:00',
    serviceId: 42,
    serviceName: 'Haircut & Style',
    timezone: 'America/New_York',
  });
  assert.match(marker, /\[booking_slot:2026-09-22\|09:00\|10:00/);
  assert.match(marker, /svc:42/);
  const parsed = parseBookingSlotMarker(`Please\n${marker}`);
  assert.equal(parsed.date, '2026-09-22');
  assert.equal(parsed.serviceId, '42');
  assert.equal(parsed.serviceName, 'Haircut & Style');
  assert.equal(parsed.timezone, 'America/New_York');
});

test('buildMessengerBookingPayload shapes pending request fields', () => {
  const payload = buildMessengerBookingPayload({
    helperId: 'h1',
    businessId: 9,
    serviceId: 3,
    serviceName: 'Trim',
    date: '2026-09-22',
    start: '09:00',
    end: '10:00',
    timezone: 'UTC',
  });
  assert.equal(payload.helperId, 'h1');
  assert.equal(payload.businessId, 9);
  assert.equal(payload.serviceId, 3);
  assert.equal(payload.requestedDate, '2026-09-22');
  assert.equal(payload.requestedStartTime, '09:00:00');
  assert.equal(payload.timezone, 'UTC');
});

test('buildSlotRequestMessage and confirmation include service name', () => {
  const msg = buildSlotRequestMessage({
    date: '2026-09-22',
    start: '09:00',
    end: '10:00',
    serviceName: 'Trim',
    providerName: 'Ada',
    locale: 'en',
  });
  assert.match(msg, /Trim/);
  assert.match(msg, /name:Trim/);
  const confirm = buildSlotConfirmationContent({
    whenLabel: 'Tue · 9:00 AM',
    serviceName: 'Trim',
  });
  assert.match(confirm, /Trim/);
  assert.ok(resolveClientTimezone());
});


test('resolveAiFailureRouting: switch to helper live when provider online + canLive', () => {
  const r = resolveAiFailureRouting({
    aiFailed: true,
    destination: 'oxsteed',
    providerOnline: true,
    canLive: true,
    allowLiveChat: true,
  });
  assert.equal(r.action, 'switch_helper_live');
  assert.equal(r.suggestedAction, 'switch_helper_live');
  assert.equal(r.autoSwitchHelper, true);
  assert.equal(r.autoRetryLive, true);
  assert.equal(r.showEscalationPanel, false);
});

test('resolveAiFailureRouting: verify banner when provider online but visitor cannot live', () => {
  const r = resolveAiFailureRouting({
    aiFailed: true,
    destination: 'helper',
    providerOnline: true,
    canLive: false,
  });
  assert.equal(r.action, 'verify_for_live');
  assert.equal(r.showVerifyBanner, true);
  assert.equal(r.autoRetryLive, false);
});

test('resolveAiFailureRouting: escalate when provider offline', () => {
  const r = resolveAiFailureRouting({
    aiFailed: true,
    destination: 'oxsteed',
    providerOnline: false,
    canLive: true,
  });
  assert.equal(r.action, 'escalate_support');
  assert.equal(r.suggestedAction, 'escalate_support');
  assert.equal(r.showEscalationPanel, true);
});

test('resolveAiFailureRouting: no action when ai did not fail', () => {
  const r = resolveAiFailureRouting({ aiFailed: false, providerOnline: true, canLive: true });
  assert.equal(r.action, null);
  assert.equal(r.suggestedAction, null);
});

test('resolveAiFailureFromServer trusts switch_helper_live flag', () => {
  const r = resolveAiFailureFromServer({
    aiFailed: true,
    suggestedAction: 'switch_helper_live',
    destination: 'oxsteed',
    providerOnline: false, // server flag wins over local guess
    canLive: false,
  });
  assert.equal(r.action, 'switch_helper_live');
  assert.equal(r.autoRetryLive, true);
});

test('resolveProviderPresenceTransition: live → offline falls back to AI', () => {
  const r = resolveProviderPresenceTransition({
    previousStatus: 'live',
    nextStatus: 'ai_assistant',
    destination: 'helper',
  });
  assert.equal(r.action, 'fallback_to_ai');
  assert.equal(r.showAiBanner, true);
});

test('resolveProviderPresenceTransition: offline → live offers connect', () => {
  const r = resolveProviderPresenceTransition({
    previousStatus: 'ai_assistant',
    nextStatus: 'live',
    destination: 'helper',
  });
  assert.equal(r.action, 'offer_connect_live');
  assert.equal(r.showConnectLiveCta, true);
});

test('resolveProviderPresenceTransition ignores oxsteed destination', () => {
  const r = resolveProviderPresenceTransition({
    previousStatus: 'ai_assistant',
    nextStatus: 'live',
    destination: 'oxsteed',
  });
  assert.equal(r.action, null);
});

test('canVisitorLive and OxSteed never live-agent', () => {
  assert.equal(canVisitorLive({ isAuthenticated: true }), true);
  assert.equal(canVisitorLive({ guestVerified: true }), true);
  assert.equal(canVisitorLive({}), false);
  assert.equal(isOxsteedDestinationLiveAgent(), false);
});

// ── Quotes in chat ───────────────────────────────────────────────────────────
import {
  buildQuoteMarker,
  parseQuoteMarker,
  parseQuoteStatusMarker,
  stripQuoteMarkers,
  isQuoteExpired,
  canCustomerRespond,
  buildShareMessageContent,
  buildRequestChangesMessage,
  toChatQuoteStatus,
  formatCents,
} from '../src/components/helperProfile/chat/messengerQuotes.js';

test('buildQuoteMarker / parseQuoteMarker round-trip', () => {
  const marker = buildQuoteMarker({
    kind: 'business',
    id: 42,
    token: 'abc123',
    status: 'sent',
    totalCents: 12500,
    title: 'Kitchen repair',
    validUntil: '2026-10-01',
    version: 2,
  });
  assert.match(marker, /^\[quote:business\|42\|/);
  const parsed = parseQuoteMarker(`Please review\n${marker}`);
  assert.equal(parsed.kind, 'business');
  assert.equal(parsed.id, '42');
  assert.equal(parsed.token, 'abc123');
  assert.equal(parsed.status, 'sent');
  assert.equal(parsed.totalCents, 12500);
  assert.equal(parsed.title, 'Kitchen repair');
  assert.equal(parsed.validUntil, '2026-10-01');
  assert.equal(parsed.version, 2);
});

test('parseQuoteMarker maps business approved status via toChatQuoteStatus', () => {
  assert.equal(toChatQuoteStatus('business', 'approved'), 'accepted');
  assert.equal(toChatQuoteStatus('helper', 'accepted'), 'accepted');
});

test('stripQuoteMarkers removes quote and status markers', () => {
  const text = 'Hello\n[quote:helper|u1|tok|sent|100|Title|2026-10-01|v1]\n[quote_status:helper|u1|accepted]\nThanks';
  const stripped = stripQuoteMarkers(text);
  assert.equal(stripped.includes('[quote:'), false);
  assert.equal(stripped.includes('[quote_status:'), false);
  assert.match(stripped, /Hello/);
  assert.match(stripped, /Thanks/);
});

test('parseQuoteStatusMarker', () => {
  const p = parseQuoteStatusMarker('[quote_status:business|99|scheduled]');
  assert.equal(p.kind, 'business');
  assert.equal(p.id, '99');
  assert.equal(p.status, 'scheduled');
});

test('isQuoteExpired: date-only valid_until inclusive through that day', () => {
  assert.equal(
    isQuoteExpired({ status: 'sent', valid_until: '2099-01-01' }, new Date('2026-09-21T12:00:00Z')),
    false,
  );
  assert.equal(
    isQuoteExpired({ status: 'sent', valid_until: '2020-01-01' }, new Date('2026-09-21T12:00:00Z')),
    true,
  );
  assert.equal(isQuoteExpired({ status: 'expired' }), true);
  assert.equal(isQuoteExpired({ status: 'sent', superseded_at: '2026-01-01' }), true);
});

test('canCustomerRespond gates on auth/guest and status', () => {
  const quote = { kind: 'helper', status: 'sent', valid_until: '2099-12-31' };
  assert.equal(canCustomerRespond(quote, { isAuthenticated: false, guestVerified: false }).ok, false);
  assert.equal(canCustomerRespond(quote, { isAuthenticated: false, guestVerified: false }).reason, 'verify_required');
  assert.equal(canCustomerRespond(quote, { isAuthenticated: true }).ok, true);
  assert.equal(canCustomerRespond(quote, { guestVerified: true }).ok, true);
  assert.equal(
    canCustomerRespond({ ...quote, status: 'accepted' }, { isAuthenticated: true }).ok,
    false,
  );
});

test('buildShareMessageContent and request-changes template', () => {
  const marker = buildQuoteMarker({ kind: 'helper', id: 'x', totalCents: 5000, title: 'Fix' });
  const content = buildShareMessageContent({ marker, title: 'Fix', totalCents: 5000 });
  assert.match(content, /Fix/);
  assert.match(content, /\[quote:helper\|/);
  assert.match(buildRequestChangesMessage({ title: 'Fix', reason: 'too high' }), /too high/);
  assert.match(formatCents(1999, 'en'), /19\.99|\$19/);
});


import {
  buildPopMarker,
  parsePopMarker,
  stripPopMarkers,
} from '../src/components/helperProfile/chat/messengerPop.js';
import {
  buildAgreementMarker,
  parseAgreementMarker,
  canCustomerRespondToAgreement,
  stripAgreementMarkers,
} from '../src/components/helperProfile/chat/messengerAgreements.js';

test('POP marker round-trip', () => {
  const marker = buildPopMarker({
    id: 'pop1',
    status: 'submitted',
    amountCents: 4200,
    paymentMethod: 'Cash App',
    transactionId: 'tx1',
    paidOn: '2026-09-21',
    quoteKind: 'business',
    quoteId: '9',
  });
  const parsed = parsePopMarker(`POP\n${marker}`);
  assert.equal(parsed.id, 'pop1');
  assert.equal(parsed.amountCents, 4200);
  assert.equal(parsed.paymentMethod, 'Cash App');
  assert.equal(stripPopMarkers(`A\n${marker}\nB`).includes('[pop:'), false);
});

test('Agreement marker + respond gate', () => {
  const marker = buildAgreementMarker({
    id: 'ag1',
    token: 't',
    status: 'shared',
    version: 1,
    title: 'Terms',
  });
  const parsed = parseAgreementMarker(marker);
  assert.equal(parsed.title, 'Terms');
  assert.equal(
    canCustomerRespondToAgreement({ status: 'shared' }, { isAuthenticated: true }).ok,
    true,
  );
  assert.equal(
    canCustomerRespondToAgreement({ status: 'shared' }, { isAuthenticated: false, guestVerified: false }).reason,
    'verify_required',
  );
  assert.equal(stripAgreementMarkers(`X\n${marker}`).includes('[agreement:'), false);
});

import {
  buildPaymentRequestMarker,
  parsePaymentRequestMarker,
  stripPaymentRequestMarkers,
  canPayWithOxsteedCredit,
  validateCreditPayAmount,
  normalizeIdempotencyKey,
  makeCreditPayIdempotencyKey,
  assertConversationMembershipHint,
} from '../src/components/helperProfile/chat/messengerCreditPay.js';

test('payment request marker round-trip', () => {
  const marker = buildPaymentRequestMarker({
    id: 'pr9',
    amountCents: 3300,
    currency: 'USD',
    status: 'open',
    memo: 'Half deposit',
    quoteKind: 'helper',
    quoteId: 'hq1',
  });
  const parsed = parsePaymentRequestMarker(`Pay please\n${marker}`);
  assert.equal(parsed.id, 'pr9');
  assert.equal(parsed.amountCents, 3300);
  assert.equal(parsed.memo, 'Half deposit');
  assert.equal(stripPaymentRequestMarkers(`A\n${marker}\nB`).includes('[payment_req:'), false);
});

test('credit pay amount + idempotency helpers', () => {
  assert.equal(validateCreditPayAmount(0).ok, false);
  assert.equal(validateCreditPayAmount(500).ok, true);
  assert.equal(normalizeIdempotencyKey('abc').ok, false);
  assert.equal(normalizeIdempotencyKey('abcdefghi').ok, true);
  const key = makeCreditPayIdempotencyKey({ conversationId: 'c', amountCents: 100 });
  assert.ok(key.length >= 8);
  assert.ok(key.length <= 160);
});

test('credit pay auth gate + membership hint', () => {
  assert.equal(canPayWithOxsteedCredit({ isAuthenticated: true }).ok, true);
  assert.equal(
    canPayWithOxsteedCredit({ isAuthenticated: false, guestVerified: true }).reason,
    'auth_required_for_credit',
  );
  assert.equal(assertConversationMembershipHint({ userId: 'a', customerId: 'a' }).ok, true);
  assert.equal(assertConversationMembershipHint({ userId: 'a', customerId: 'b' }).code, 'customer_only');
});

import {
  buildCreditRefundMarker,
  parseCreditRefundMarker,
  stripCreditRefundMarkers,
} from '../src/components/helperProfile/chat/messengerCreditPay.js';

test('credit refund marker round-trip', () => {
  const marker = buildCreditRefundMarker({
    id: 'rf-1',
    amountCents: 4200,
    currency: 'usd',
    status: 'posted',
    popId: 'pop-1',
    refundTxnId: 'txn-1',
  });
  const parsed = parseCreditRefundMarker(`Thanks\n${marker}`);
  assert.equal(parsed.id, 'rf-1');
  assert.equal(parsed.amountCents, 4200);
  assert.equal(parsed.currency, 'USD');
  assert.equal(stripCreditRefundMarkers(`x\n${marker}\ny`).includes('[credit_refund:'), false);
});
