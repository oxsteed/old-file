import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MESSENGER_MOBILE_BREAKPOINT,
  shouldShowGuestGate,
  getMessengerPhase,
  shouldShowLauncher,
  resolveDockLayout,
  shouldPulseLauncher,
  guestContactStorageKey,
  isValidGuestEmail,
  canContinueAsGuest,
  defaultProfileChatDestination,
} from '../src/components/helperProfile/chat/messengerDockState.js';
import {
  buildSupportEscalationHandoff,
  readSupportEscalationHandoff,
} from '../src/components/helperProfile/chat/supportEscalationHandoff.js';

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
