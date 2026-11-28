// Pure helpers for the /oxsteed-credit redesign (D-801/D-802/D-806).
// No DOM, no network, no i18n: every function here is unit-testable in
// isolation, and the page component stays a thin shell over them.

// D-802: per-browser UI state (currency, activity tab) lives in
// localStorage under one versioned key. Cross-device sync through account
// preferences is a follow-up, not this build: a shared browser profile is
// the only scope this key promises.
export const CREDIT_UI_STORAGE_KEY = 'oxsteed-credit-ui-v1';

export const CREDIT_ACTIVITY_TABS = ['all', 'holds', 'pending', 'disputes'];

const DEFAULT_UI_STATE = Object.freeze({ currency: 'USD', activityTab: 'all' });

function isValidCurrency(value) {
  return typeof value === 'string' && /^[A-Z]{3}$/.test(value);
}

export function readCreditUiState(storage) {
  try {
    const raw = storage?.getItem?.(CREDIT_UI_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_UI_STATE };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ...DEFAULT_UI_STATE };
    return {
      currency: isValidCurrency(parsed.currency) ? parsed.currency : DEFAULT_UI_STATE.currency,
      activityTab: CREDIT_ACTIVITY_TABS.includes(parsed.activityTab) ? parsed.activityTab : DEFAULT_UI_STATE.activityTab,
    };
  } catch {
    return { ...DEFAULT_UI_STATE };
  }
}

export function writeCreditUiState(storage, state) {
  try {
    storage?.setItem?.(CREDIT_UI_STORAGE_KEY, JSON.stringify({
      currency: isValidCurrency(state?.currency) ? state.currency : DEFAULT_UI_STATE.currency,
      activityTab: CREDIT_ACTIVITY_TABS.includes(state?.activityTab) ? state.activityTab : DEFAULT_UI_STATE.activityTab,
    }));
  } catch {
    // A full or unavailable store never blocks the page.
  }
}

// Gap 4 (D-806): money-out actions (Send, Withdraw, Pay in store,
// Convert) are disabled with a stated reason while the rail is paused or
// the account is not active. The server still rejects on submit; this is
// the client-side statement of the same gate, never a replacement for it.
// A null rail status means "still loading": nothing is blocked until the
// rail state is known. When both apply, the rail reason wins: it is the
// condition the customer can do least about, and the account status pill
// already names the account state on the hero.
export function moneyOutBlockReason({ railEnabled, accountStatus } = {}) {
  if (railEnabled === false) return 'railPaused';
  if (accountStatus && accountStatus !== 'active') return 'accountNotActive';
  return null;
}

// D-798: the Send drawer accepts a recipient by customer UUID, by
// 10-digit account number, or by 16-digit card number (typed or scanned
// from a card/QR code). Scanned numbers may carry spaces or dashes;
// normalize those away before classifying. The three shapes never
// overlap, so classification is unambiguous.
export function classifyRecipientInput(raw) {
  const compact = String(raw || '').replace(/[\s-]/g, '');
  if (/^[0-9a-fA-F-]{36}$/.test(String(raw || '').trim())) return 'customerId';
  if (/^\d{10}$/.test(compact)) return 'accountNumber';
  if (/^\d{16}$/.test(compact)) return 'cardNumber';
  return 'unknown';
}

// The hero card thumbnail never shows more than the last four digits.
export function formatMaskedCardNumber(last4) {
  if (!last4) return null;
  return `•••• •••• •••• ${String(last4).slice(-4)}`;
}

// A revealed or freshly issued number is shown grouped in fours, once.
export function groupCardNumber(number) {
  const digits = String(number || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.replace(/(\d{4})(?=\d)/g, '$1 ');
}
