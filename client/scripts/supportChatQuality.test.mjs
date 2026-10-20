import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  FEEDBACK_REASONS,
  NUDGE_MIN_INTERVAL_MS,
  NUDGE_TRIGGERS,
  dismissNudge,
  latestReplyId,
  markNudgeShown,
  nextFeedback,
  pickNudge,
  trapFocus,
} from '../src/components/supportChatActionState.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOCALES = ['en', 'es', 'fr', 'ht', 'ar'];

function memoryStorage() {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), map };
}

test('item 5: same thumb again un-toggles; latest reply id for handoff', () => {
  assert.equal(nextFeedback(null, 'up'), 'up');
  assert.equal(nextFeedback('up', 'up'), null);
  assert.equal(nextFeedback('up', 'down'), 'down');
  assert.equal(latestReplyId([{ role: 'assistant', replyId: 'a' }, { role: 'user' }, { role: 'assistant', replyId: 'b' }, { role: 'assistant', handoff: true }]), 'b');
  assert.equal(latestReplyId([{ role: 'user' }]), null);
});

test('item 9: one nudge per day per user, never a dismissed trigger, safe paths only', () => {
  const storage = memoryStorage();
  const list = [
    { trigger: 'payment_failed', key: 'payment_failed:1', path: '/orders/1' },
    { trigger: 'job_no_bids', key: 'job_no_bids:j', path: '/jobs/j' },
  ];
  const now = 1_000_000_000_000;
  assert.equal(pickNudge(list, { storage, scope: 'u1', now }).key, 'payment_failed:1');
  markNudgeShown({ storage, scope: 'u1', now });
  assert.equal(pickNudge(list, { storage, scope: 'u1', now: now + 1000 }), null, 'frequency cap');
  assert.equal(pickNudge(list, { storage, scope: 'u2', now: now + 1000 }).key, 'payment_failed:1', 'cap is per user');
  dismissNudge('payment_failed:1', { storage, scope: 'u1' });
  assert.equal(pickNudge(list, { storage, scope: 'u1', now: now + NUDGE_MIN_INTERVAL_MS + 1 }).key, 'job_no_bids:j');
  assert.equal(pickNudge([{ trigger: 'payment_failed', key: 'x', path: '//evil.example' }], { storage, scope: 'u3', now }), null);
  assert.equal(pickNudge([{ trigger: 'unknown', key: 'x', path: '/x' }], { storage, scope: 'u3', now }), null);
  // No analytics: only these two functional keys are written.
  assert.deepEqual([...storage.map.keys()].sort(), ['oxs:support-nudge:u1:dismissed', 'oxs:support-nudge:u1:last-shown']);
});

test('item 8: Tab wraps inside the dialog in both directions', () => {
  const focused = [];
  const el = (name) => ({ name, focus: () => focused.push(name) });
  const [a, b, c] = [el('a'), el('b'), el('c')];
  const ev = (shiftKey) => ({ key: 'Tab', shiftKey, prevented: false, preventDefault() { this.prevented = true; } });
  let e = ev(false);
  assert.equal(trapFocus(e, [a, b, c], c), true);
  assert.equal(e.prevented, true);
  e = ev(true);
  assert.equal(trapFocus(e, [a, b, c], a), true);
  e = ev(false);
  assert.equal(trapFocus(e, [a, b, c], b), false);
  assert.equal(trapFocus({ key: 'Enter' }, [a], a), false);
  assert.deepEqual(focused, ['a', 'c']);
});

test('PR C copy exists in all five locales', async () => {
  const sw = ['messageLog', 'typing', 'userImageAlt', 'pendingImageAlt', 'messageInput', 'voiceInput', 'feedbackReasonPrompt', 'nudgeOpen', 'nudgeDismiss',
    ...FEEDBACK_REASONS.map((r) => `feedbackReason_${r}`), ...NUDGE_TRIGGERS.map((n) => `nudge_${n}`)];
  const admin = ['title', 'range', 'days_one', 'days_other', 'show', 'hide', 'failed', 'replies', 'deflection', 'handoffRate', 'suggestedRate', 'thumbsDownRate', 'empty', 'page', 'locale', 'reasons']
    .map((k) => `aiMetrics.${k}`);
  for (const loc of LOCALES) {
    const cat = JSON.parse(await readFile(join(root, 'src/locales', `${loc}.json`), 'utf8'));
    for (const k of sw) assert.ok(cat.supportWidget[k], `${loc} supportWidget.${k}`);
    for (const k of admin) assert.ok(cat.adminSupportTickets[k], `${loc} adminSupportTickets.${k}`);
    assert.match(cat.supportWidget.nudge_job_no_bids, /\{\{days\}\}/);
  }
});

test('widget accessibility and wiring', async () => {
  const src = await readFile(join(root, 'src/components/SupportWidget.jsx'), 'utf8');
  assert.match(src, /role="dialog"\s+aria-modal="true"\s+aria-labelledby="support-widget-title"/);
  assert.match(src, /id="support-widget-title"/);
  assert.match(src, /role="log"\s+aria-live="polite"/);
  assert.match(src, /role="status" aria-label=\{t\('supportWidget\.typing'\)\}/);
  assert.match(src, /trapFocus\(e, focusableWithin\(panelRef\.current\)/);
  assert.match(src, /returnFocusRef/);
  assert.match(src, /alt=\{t\('supportWidget\.userImageAlt'\)\}/);
  assert.doesNotMatch(src, /src=\{m\.image\}\s+alt=""/);
  // Copy/thumbs: visible on keyboard focus and on touch (no hover) devices.
  assert.doesNotMatch(src, /opacity-0 group-hover:opacity-100 (?!group-focus-within)/);
  assert.match(src, /\[@media\(hover:none\)\]:opacity-100/);
  assert.match(src, /<SpeechToTextInput/);
  assert.match(src, /api\.get\('\/chat\/nudges'\)/);
  assert.match(src, /reply_id: replyId, value/);
  assert.match(src, /reply_id: fromReplyId/);
  const speech = await readFile(join(root, 'src/components/SpeechToTextInput.tsx'), 'utf8');
  assert.match(speech, /recognition\.lang = language/);
});
