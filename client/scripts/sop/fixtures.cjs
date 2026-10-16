/**
 * fixtures.cjs - synthetic API mock source builder.
 *
 * buildApiMockSource() returns the JS source for the fixture 'api/axios'
 * module. Sections are appended per area as capture work proceeds.
 *
 * Browser-side controls (set via page.addInitScript before load):
 *   window.__sopUser      - synthetic user object or null (guest)
 *   window.__sopDataMode  - 'full' | 'empty'
 *   window.__sopFlags     - { flagName: true } for conditional states
 *
 * Conventions: deterministic synthetic records, USD amounts, dates in
 * October 2026. Never real PII, never real transactions.
 */

const BASE = `
window.__sopApiLog = [];
function __sopLog(method, url) {
  try { window.__sopApiLog.push(method + ' ' + String(url).split('?')[0]); } catch (e) {}
}
function __sopEmpty() { return window.__sopDataMode === 'empty'; }
function __sopFlag(name) { return !!(window.__sopFlags && window.__sopFlags[name]); }
function __sopErr(status, message) {
  const e = new Error(message || ('HTTP ' + status));
  e.response = { status: status, data: { error: message || ('HTTP ' + status) } };
  return e;
}
function __sopQuery(raw) {
  const out = {};
  const q = String(raw || '').split('?')[1];
  if (!q) return out;
  for (const part of q.split('&')) {
    const [k, v] = part.split('=');
    if (k) out[decodeURIComponent(k)] = decodeURIComponent(v || '');
  }
  return out;
}
const __ROUTES = [];
function __sopRoute(method, re, fn) { __ROUTES.push([method, re, fn]); }

function __sopRespond(method, url, data) {
  const raw = String(url || '');
  const p = raw.split('?')[0];
  __sopLog(method, raw);
  const query = __sopQuery(raw);
  for (const [m, re, fn] of __ROUTES) {
    if (m !== method && m !== '*') continue;
    const match = p.match(re);
    if (match) return { data: fn(match, data, query, method) };
  }
  // Unmapped endpoint: log loudly and return an empty object so the page
  // renders its empty/error state instead of crashing.
  try { (window.__sopUnmapped = window.__sopUnmapped || []).push(method + ' ' + p); } catch (e) {}
  return { data: {} };
}

const __later = (fn) => Promise.resolve().then(fn);
const api = {
  get: (url, config) => __later(() => __sopRespond('get', url)),
  post: (url, data, config) => __later(() => __sopRespond('post', url, data)),
  put: (url, data, config) => __later(() => __sopRespond('put', url, data)),
  patch: (url, data, config) => __later(() => __sopRespond('patch', url, data)),
  delete: (url, config) => __later(() => __sopRespond('delete', url)),
  request: (config) => __later(() => __sopRespond(((config && config.method) || 'get').toLowerCase(), config && config.url)),
  interceptors: { request: { use() {} }, response: { use() {} } },
  defaults: { headers: { common: {} } },
};

/* ---- base routes: auth, consent, capabilities, push ---- */
__sopRoute('get', /^\\/?auth\\/me$/, () => {
  const user = window.__sopUser || null;
  if (!user) throw __sopErr(401, 'Unauthorized');
  // Mode override stashed by /auth/switch-role (mirrors the server
  // persisting the mode across the reload the app performs on switch).
  let mode = null;
  try { mode = sessionStorage.getItem('__sop_mode'); } catch (e) {}
  if (mode) return { user: Object.assign({}, user, { default_mode: mode }) };
  return { user };
});
__sopRoute('get', /^\\/consent\\/status$/, () => ({ outstanding: [] }));
__sopRoute('post', /^\\/consent\\/accept$/, () => ({ ok: true }));
__sopRoute('get', /^\\/config\\/capabilities$/, () => ({
  capabilities: { aiSupport: { available: false } },
}));
__sopRoute('get', /^\\/notifications\\/webpush\\/public-key$/, () => ({
  enabled: false, publicKey: null,
}));
__sopRoute('get', /^\\/launch-visibility$/, () => ({}));
__sopRoute('get', /^\\/support\\/agent\\/me$/, () => null);
__sopRoute('get', /^\\/notifications$/, () => {
  if (__sopEmpty()) return { notifications: [], unread_count: 0 };
  return { notifications: [
    { id: 'sop-notif-1', title: 'Bid received', body: 'Sam Helper bid $85 on \\'Fix leaky faucet\\'.', is_read: false, created_at: '2026-10-15T14:20:00Z', link: '/jobs/sop-job-1' },
    { id: 'sop-notif-2', title: 'Order update', body: 'Your Harborview Bakery order is ready for pickup.', is_read: true, created_at: '2026-10-14T11:05:00Z', link: '/food/orders/sop-order-1' },
  ], unread_count: 1 };
});
__sopRoute('put', /^\\/notifications\\/[^/]+\\/read$/, () => ({ ok: true }));
__sopRoute('get', /^\\/messages\\/conversations$/, () => {
  if (__sopEmpty()) return { conversations: [] };
  return { conversations: [
    { id: 'sop-conv-1', subject: 'Fix leaky faucet', other_party_name: 'Sam Helper', last_message: 'I can come by Thursday morning.', last_message_at: '2026-10-15T15:02:00Z', unread_count: 2 },
    { id: 'sop-conv-2', subject: 'Lawn mowing quote', other_party_name: 'Greenline Yard Co', last_message: 'Quote sent: $60 for the full yard.', last_message_at: '2026-10-13T09:40:00Z', unread_count: 0 },
  ] };
});
__sopRoute('get', /^\\/messages\\/guest-inquiries$/, () => ({ inquiries: [] }));
__sopRoute('post', /^\\/analytics\\/pageview$/, () => ({ ok: true }));

export default api;
`;

const SECTIONS = [];

function buildApiMockSource() {
  return BASE + '\n' + SECTIONS.join('\n');
}

function addSection(name, source) {
  SECTIONS.push(`/* ---- ${name} ---- */\n` + source);
}

module.exports = { buildApiMockSource, addSection };

/* ================= account area ================= */
addSection('account', `
__sopRoute('get', /^\\/didit\\/status$/, () => {
  const mode = __sopFlag('didit');
  if (mode === 'verified') return { status: 'verified' };
  if (mode === 'pending') return { status: 'pending', hasSession: true };
  if (mode === 'failed') return { status: 'failed' };
  return { status: 'none' };
});
__sopRoute('post', /^\\/didit\\/session$/, () => ({}));
__sopRoute('post', /^\\/didit\\/skip$/, () => ({ ok: true }));

__sopRoute('post', /^\\/auth\\/login$/, () => {
  if (__sopFlag('mfa')) return { requiresTwoFactor: true, mfaToken: 'sop-mfa-token-001' };
  return { user: window.__sopUser };
});
__sopRoute('post', /^\\/auth\\/login\\/2fa$/, () => ({ user: window.__sopUser }));
__sopRoute('post', /^\\/auth\\/forgot-password$/, () => ({ ok: true }));
__sopRoute('post', /^\\/auth\\/reset-password$/, () => ({ ok: true }));
__sopRoute('post', /^\\/auth\\/register\\/start$/, () => ({ token: 'sop-reg-token-001' }));
__sopRoute('post', /^\\/auth\\/register\\/accept-terms$/, () => ({
  resendAvailableAt: new Date(Date.now() + 60000).toISOString(),
}));
__sopRoute('post', /^\\/auth\\/register\\/verify-otp$/, () => ({ user: window.__sopUser }));
__sopRoute('post', /^\\/auth\\/register\\/resend$/, () => ({ ok: true }));
__sopRoute('post', /^\\/auth\\/switch-role$/, (m, data) => {
  const mode = (data && (data.mode || data.target_role)) || 'customer';
  try { sessionStorage.setItem('__sop_mode', mode); } catch (e) {}
  return { user: Object.assign({}, window.__sopUser, { default_mode: mode }) };
});
// /auth/me applies a mode override stashed by switch-role (mirrors the
// server persisting the mode across the reload the app performs).
__sopRoute('get', /^\\/jobs\\/me\\/list$/, () => {
  if (__sopEmpty()) return { jobs: [] };
  return { jobs: [
    { id: 'sop-job-1', title: 'Fix leaky kitchen faucet', status: 'open', bid_count: 3, created_at: '2026-10-14T10:00:00Z', budget_min: 50, budget_max: 120 },
    { id: 'sop-job-2', title: 'Mow front and back yard', status: 'assigned', bid_count: 5, created_at: '2026-10-12T09:30:00Z', budget_min: 40, budget_max: 80 },
  ] };
});
__sopRoute('get', /^\\/food\\/my\\/orders$/, () => {
  if (__sopEmpty()) return { orders: [] };
  return { orders: [
    { id: 'sop-order-1', restaurant_name: 'Harborview Bakery', status: 'ready', total_cents: 2450, created_at: '2026-10-15T12:10:00Z' },
  ] };
});
__sopRoute('get', /^\\/food\\/customer\\/wallets$/, () => ({ wallets: [] }));
__sopRoute('get', /^\\/credit\\/account$/, () => null);

__sopRoute('get', /^\\/subscription\\/current$/, () => ({ subscription: null }));
__sopRoute('get', /^\\/subscription\\/plans$/, () => ({ plans: [] }));
__sopRoute('get', /^\\/businesses$/, () => {
  if (__sopEmpty()) return { businesses: [] };
  return { businesses: [
    { id: 'sop-biz-1', business_name: 'Maple Street Plumbing', status: 'active', city: 'Dayton' },
  ] };
});
__sopRoute('get', /^\\/me\\/businesses$/, () => {
  if (__sopEmpty()) return { data: { items: [] } };
  return { data: { items: [
    { id: 'sop-biz-1', business_name: 'Maple Street Plumbing', status: 'active', city: 'Dayton', is_owner: true },
  ] } };
});

__sopRoute('get', /^\\/support-routing\\/status$/, () => {
  if (__sopFlag('supportLive')) return { liveAvailableAgents: 2, agents: 2, routingMode: 'live' };
  return { liveAvailableAgents: 0, agents: 0, routingMode: 'ticket' };
});
__sopRoute('post', /^\\/support-routing\\/connect$/, () => {
  if (__sopFlag('supportLive')) return {
    routedTo: 'agent', ticketId: 'sop-ticket-001',
    assignedAgent: { name: 'Ava Support', role: 'Support specialist' },
    messages: [
      { id: 'sop-sm-1', sender: { type: 'agent', name: 'Ava Support' }, content: 'Hi Sop, I can help with that. What seems to be the problem?', timestamp: '2026-10-16T09:58:00Z' },
    ],
    status: 'open',
  };
  return { routedTo: 'ticket', ticketId: 'sop-ticket-002', status: 'queued', waiting: null };
});
__sopRoute('post', /^\\/support-routing\\/conversations$/, () => ({ ticketId: 'SOP-2026-0042' }));
__sopRoute('get', /^\\/support\\/my-tickets\\/([^/]+)$/, (m) => {
  const id = m[1];
  return { ticket: {
    id, ticket_id: 'SOP-2026-0042', subject: 'Refund for cancelled booking', category: 'Payment',
    priority: 'normal', status: 'open', name: 'Sop Customer', email: 'sop.customer@example.com',
    created_at: '2026-10-15T16:20:00Z', updated_at: '2026-10-15T18:02:00Z',
  }, messages: [
    { id: 'sop-tm-1', is_from_admin: false, sender_name: 'Sop Customer', content: 'Hi, my helper cancelled and I was still charged. Can I get a refund?', created_at: '2026-10-15T16:20:00Z' },
    { id: 'sop-tm-2', is_from_admin: true, content: 'Thanks for reaching out. I have issued the refund; it should arrive within 5 business days.', created_at: '2026-10-15T18:02:00Z' },
  ] };
});
__sopRoute('post', /^\\/support\\/my-tickets\\/[^/]+\\/reply$/, () => ({ ok: true }));
__sopRoute('post', /^\\/support\\/my-tickets\\/[^/]+\\/reopen$/, () => ({ ok: true }));
__sopRoute('post', /^\\/support\\/conversations\\/[^/]+\\/message$/, () => ({ ok: true }));

__sopRoute('get', /^\\/helper-registration\\/onboarding\\/status$/, () => {
  const mode = __sopFlag('onboarding');
  if (mode === 'done') return { steps: { email: true, terms: true, profile: true, identityVerified: true, identitySubmitted: true, background: 'passed' } };
  if (mode === 'terms-done') return { steps: { email: true, terms: true, profile: false, identityVerified: false, identitySubmitted: false, background: 'none' } };
  return { steps: { email: true, terms: false, profile: false, identityVerified: false, identitySubmitted: false, background: 'none' } };
});
__sopRoute('put', /^\\/helper-registration\\/onboarding\\/profile$/, () => ({ ok: true }));
__sopRoute('post', /^\\/helper-registration\\/accept-terms$/, () => ({ ok: true }));
__sopRoute('post', /^\\/helper-registration\\/finalize$/, () => ({ ok: true }));
__sopRoute('post', /^\\/helper-registration\\/onboarding\\/background-check$/, () => ({ ok: true }));

__sopRoute('patch', /^\\/settings\\/privacy$/, () => ({ ok: true }));
__sopRoute('post', /^\\/privacy\\/export\\/verification\\/request$/, () => ({
  challengeToken: 'sop-challenge-001', emailHint: 's•••@example.com',
}));
__sopRoute('post', /^\\/privacy\\/export\\/verification\\/verify$/, () => ({ exportToken: 'sop-export-token-001' }));
__sopRoute('get', /^\\/privacy\\/export$/, () => ({}));
__sopRoute('delete', /^\\/privacy\\/delete-account$/, () => {
  throw __sopErr(400, 'Account has unresolved items');
});
`);

/* ================= business-work area ================= */
addSection('business-work', `
__sopRoute('get', /^\\/businesses\\/attention$/, () => {
  if (__sopEmpty()) return { totals: { total: 0, affectedBusinesses: 0 }, items: [] };
  return { totals: { total: 3, affectedBusinesses: 1 }, items: [
    { id: 'sop-att-1', type: 'invoice_overdue', title: 'Invoice #INV-001 overdue', detail: 'Maple Street Plumbing owes $450', created_at: '2026-10-15T10:00:00Z' },
    { id: 'sop-att-2', type: 'new_booking', title: 'New booking request', detail: 'Faucet repair on Oct 18', created_at: '2026-10-15T14:00:00Z' },
    { id: 'sop-att-3', type: 'review', title: 'New review to respond to', detail: '5-star review from Jane D.', created_at: '2026-10-14T09:00:00Z' },
  ] };
});
__sopRoute('get', /^\\/businesses\\/managed$/, () => ({
  businesses: [ { id: 'sop-biz-1', business_name: 'Maple Street Plumbing', status: 'active', role: 'owner' } ],
}));
__sopRoute('get', /^\\/businesses\\/invitations$/, () => ({
  invitations: [ { id: 'sop-inv-1', business_name: 'Greenline Yard Co', role: 'member', status: 'pending' } ],
}));
__sopRoute('get', /^\\/businesses\\/([^/]+)$/, (m) => ({
  business: { id: m[1], business_name: 'Maple Street Plumbing', status: 'active', city: 'Dayton', description: 'Full-service plumbing for homes and businesses.' },
}));
__sopRoute('get', /^\\/businesses\\/([^/]+)\\/invoices$/, () => {
  if (__sopEmpty()) return { invoices: [], summary: {} };
  return { invoices: [
    { id: 'sop-inv-001', number: 'INV-001', client_name: 'Jane Doe', amount: 450, status: 'overdue', due_date: '2026-10-10', created_at: '2026-10-01T10:00:00Z' },
    { id: 'sop-inv-002', number: 'INV-002', client_name: 'Bob Smith', amount: 1200, status: 'sent', due_date: '2026-10-20', created_at: '2026-10-05T10:00:00Z' },
    { id: 'sop-inv-003', number: 'INV-003', client_name: 'Acme Corp', amount: 850, status: 'paid', due_date: '2026-10-01', created_at: '2026-09-20T10:00:00Z' },
  ],
  summary: { draft: 0, sent: 1, paid: 1, overdue: 1, outstanding_total: 1650 } };
});
__sopRoute('post', /^\\/businesses\\/([^/]+)\\/invoices$/, (m, data) => ({
  invoice: { id: 'sop-inv-new', number: 'INV-004', client_name: (data && data.client_name) || 'New Client', amount: (data && data.amount) || 0, status: 'draft' },
}));
__sopRoute('get', /^\\/businesses\\/invoices\\/public\\/([^/]+)$/, (m) => ({
  invoice: { id: 'sop-inv-001', number: 'INV-001', business_name: 'Maple Street Plumbing', client_name: 'Jane Doe', amount: 450, status: 'sent', due_date: '2026-10-20', line_items: [ { description: 'Faucet repair', quantity: 1, amount: 450 } ] },
}));
__sopRoute('get', /^\\/businesses\\/([^/]+)\\/clients$/, () => {
  if (__sopEmpty()) return { data: { clients: [] } };
  return { data: { clients: [
    { id: 'sop-client-1', name: 'Jane Doe', email: 'jane@example.com', phone: '9375550101', total_spent: 1250 },
    { id: 'sop-client-2', name: 'Bob Smith', email: 'bob@example.com', phone: '9375550102', total_spent: 800 },
  ] } };
});
__sopRoute('post', /^\\/businesses\\/([^/]+)\\/clients$/, (m, data) => ({
  client: { id: 'sop-client-new', name: (data && data.name) || 'New Client', email: (data && data.email) || '' },
}));
__sopRoute('get', /^\\/businesses\\/([^/]+)\\/members$/, () => ({
  members: [
    { id: 'sop-mem-1', name: 'Owen Owner', email: 'sop.owner@example.com', role: 'owner', status: 'active' },
    { id: 'sop-mem-2', name: 'Sam Helper', email: 'sam@example.com', role: 'member', status: 'pending' },
  ],
}));
__sopRoute('post', /^\\/businesses\\/([^/]+)\\/members$/, () => ({ ok: true }));
__sopRoute('get', /^\\/businesses\\/([^/]+)\\/services$/, () => {
  if (__sopEmpty()) return { services: [] };
  return { services: [
    { id: 'sop-svc-1', name: 'Faucet Repair', price: 85, active: true, description: 'Fix leaky faucets' },
    { id: 'sop-svc-2', name: 'Drain Cleaning', price: 120, active: false, description: 'Clear clogged drains' },
  ] };
});
__sopRoute('post', /^\\/businesses\\/([^/]+)\\/services$/, (m, data) => ({
  service: { id: 'sop-svc-new', name: (data && data.name) || 'New Service', price: (data && data.price) || 0, active: true },
}));
__sopRoute('get', /^\\/businesses\\/([^/]+)\\/calendar\\/summary$/, () => ({
  data: { upcoming: 3, today: 1 },
}));
__sopRoute('get', /^\\/businesses\\/([^/]+)\\/calendar$/, () => ({
  data: { events: [
    { id: 'sop-ev-1', title: 'Faucet repair - Jane Doe', start: '2026-10-18T09:00:00Z', end: '2026-10-18T10:00:00Z' },
    { id: 'sop-ev-2', title: 'Drain cleaning - Bob Smith', start: '2026-10-19T14:00:00Z', end: '2026-10-19T15:30:00Z' },
  ] },
}));
`);

/* ================= financial area ================= */
addSection('financial', `
__sopRoute('get', /^\\/oxsteed-credit\\/account$/, () => ({
  account: { currencyCode: 'USD', balanceCents: 12550, reservedCents: 2550, availableBalanceCents: 10000, status: 'active' },
}));
__sopRoute('get', /^\\/oxsteed-credit\\/accounts$/, () => ({
  accounts: [ { id: 'sop-ccy-usd', currency: 'USD', balance: 125.50 } ],
}));
__sopRoute('get', /^\\/oxsteed-credit\\/status$/, () => ({ enabled: true, status: 'active' }));
__sopRoute('get', /^\\/oxsteed-credit\\/limits$/, () => ({
  limits: {
    resetsAt: '2026-10-17T00:00:00Z',
    spending: { centsRemaining: 50000, centsUsed: 0, centsLimit: 50000, countRemaining: 10, countUsed: 0, countLimit: 10 },
    transfers: { enabled: true, centsRemaining: 25000, centsUsed: 0, centsLimit: 25000, countRemaining: 5, countUsed: 0, countLimit: 5 },
  },
}));
__sopRoute('get', /^\\/oxsteed-credit\\/transactions$/, () => ({
  transactions: [
    { id: 'sop-tx-1', type: 'topup', amount: 100, currency: 'USD', status: 'posted', created_at: '2026-10-15T10:00:00Z', description: 'Top-up via card' },
    { id: 'sop-tx-2', type: 'payment', amount: -25.50, currency: 'USD', status: 'posted', created_at: '2026-10-14T15:00:00Z', description: 'Food order payment' },
  ],
}));
__sopRoute('get', /^\\/oxsteed-credit\\/holds$/, () => ({
  holds: [ { id: 'sop-hold-1', amount: 25.50, status: 'active', created_at: '2026-10-15T09:00:00Z', merchant: 'Harborview Bakery' } ],
}));
__sopRoute('get', /^\\/oxsteed-credit\\/cards$/, () => ({
  cards: [ { id: 'sop-card-1', last4: '4242', brand: 'visa', status: 'active' } ],
}));
__sopRoute('get', /^\\/oxsteed-credit\\/statement-periods$/, () => ({
  periods: [ { id: 'sop-per-1', label: 'October 2026', start: '2026-10-01', end: '2026-10-31' } ],
}));
__sopRoute('get', /^\\/oxsteed-credit\\/statement$/, () => ({
  statement: { id: 'sop-stmt-1', period: 'October 2026', balance: 125.50 },
}));
__sopRoute('get', /^\\/oxsteed-credit\\/eligible-partners$/, () => ({
  partners: [ { id: 'sop-part-1', name: 'Harborview Bakery' } ],
}));
__sopRoute('get', /^\\/oxsteed-credit\\/restaurant-conversion-eligibility$/, () => ({
  eligible: true,
}));
__sopRoute('get', /^\\/qr-payments\\/pay\\/([^/]+)$/, (m) => ({
  payment: { code: m[1], amount: 25.00, currency: 'USD', status: 'pending', recipient: 'Sam Helper' },
}));
__sopRoute('get', /^\\/food\\/customer\\/wallets$/, () => ({
  wallets: [ { id: 'sop-fw-1', restaurant_name: 'Harborview Bakery', balance: 45.00, currency: 'USD' } ],
}));
__sopRoute('get', /^\\/statements\\/center$/, () => ({
  accounts: [ { id: 'sop-acct-1', name: 'OxSteed Credit', type: 'credit' } ],
}));
__sopRoute('get', /^\\/statement-archive\\/archive$/, () => ({
  statements: [ { id: 'sop-arch-1', period: 'September 2026', status: 'issued' } ],
}));
__sopRoute('get', /^\\/statements\\/exports\\/([^/]+)$/, (m) => ({
  job: { id: m[1], status: 'completed', files: [ { name: 'statement-oct-2026.pdf', url: '/files/sop-statement.pdf' } ] },
}));
`);

/* ================= helper-work area ================= */
addSection('helper-work', `
__sopRoute('get', /^\\/bids\\/me$/, () => ({
  bids: [
    { id: 'sop-bid-1', job_id: 'sop-job-1', job_title: 'Fix leaky kitchen faucet', amount: 85, status: 'pending', created_at: '2026-10-15T10:00:00Z' },
    { id: 'sop-bid-2', job_id: 'sop-job-2', job_title: 'Mow front and back yard', amount: 60, status: 'accepted', created_at: '2026-10-14T10:00:00Z' },
  ],
}));
__sopRoute('get', /^\\/bids\\/job\\/([^/]+)$/, () => ({ bids: [] }));
__sopRoute('post', /^\\/bids$/, () => ({ bid: { id: 'sop-bid-new', status: 'pending' } }));
__sopRoute('get', /^\\/payments\\/payout\\/balance$/, () => ({
  balance: { available: 250.00, pending: 75.00, currency: 'USD' },
}));
__sopRoute('get', /^\\/helpers\\/([^/]+)\\/profile$/, (m) => ({
  profile: { id: m[1], name: 'Sam Helper', bio: 'Experienced handyman.', rating: 4.8, jobs_completed: 42 },
}));
__sopRoute('get', /^\\/chat\\/quotes\\/history$/, () => ({
  quotes: [ { id: 'sop-q-1', amount: 85, status: 'sent', created_at: '2026-10-15T10:00:00Z' } ],
}));
`);

/* ================= hiring area ================= */
addSection('hiring', `
__sopRoute('get', /^\\/bookings$/, () => ({
  bookings: [ { id: 'sop-bk-1', helper_name: 'Sam Helper', service: 'Faucet repair', status: 'pending', date: '2026-10-18' } ],
}));
__sopRoute('get', /^\\/jobs\\/([^/]+)$/, (m) => ({
  job: { id: m[1], title: 'Fix leaky kitchen faucet', description: 'Kitchen faucet drips constantly.', status: 'open', budget_min: 50, budget_max: 120, bids: [ { id: 'sop-bid-1', helper_name: 'Sam Helper', amount: 85, status: 'pending' } ] },
}));
__sopRoute('get', /^\\/bids\\/([^/]+)$/, (m) => ({
  bid: { id: m[1], job_title: 'Fix leaky kitchen faucet', helper_name: 'Sam Helper', amount: 85, status: 'pending' },
}));
__sopRoute('get', /^\\/agreements\\/([^/]+)$/, (m) => ({
  agreement: { id: m[1], title: 'Faucet Repair Agreement', status: 'active', parties: ['Sop Customer', 'Sam Helper'] },
}));
__sopRoute('get', /^\\/disputes$/, () => ({
  disputes: [ { id: 'sop-dsp-1', title: 'Refund for cancelled booking', status: 'open', created_at: '2026-10-15T10:00:00Z' } ],
}));
__sopRoute('get', /^\\/disputes\\/([^/]+)$/, (m) => ({
  dispute: { id: m[1], title: 'Refund for cancelled booking', status: 'open', description: 'Helper cancelled but I was charged.' },
}));
__sopRoute('get', /^\\/helpers$/, () => ({
  helpers: [ { id: 'sop-helper-1', name: 'Sam Helper', rating: 4.8, skills: ['Plumbing'] } ],
}));
`);

/* ================= logistics area ================= */
addSection('logistics', `
__sopRoute('get', /^\\/logistics\\/campaigns$/, () => ({
  campaigns: [ { id: 'sop-camp-1', title: 'Community Rice Import', status: 'active', progress: 65 } ],
}));
__sopRoute('get', /^\\/logistics\\/campaigns\\/([^/]+)$/, (m) => ({
  campaign: { id: m[1], title: 'Community Rice Import', status: 'active', description: 'Bulk rice import for the community.' },
}));
__sopRoute('get', /^\\/logistics\\/shipments$/, () => ({
  shipments: [ { id: 'sop-ship-1', reference: 'SHP-001', status: 'in_transit', origin: 'Miami', destination: 'Port-au-Prince' } ],
}));
__sopRoute('get', /^\\/logistics\\/shipments\\/([^/]+)$/, (m) => ({
  shipment: { id: m[1], reference: 'SHP-001', status: 'in_transit', milestones: [ { title: 'Departed', date: '2026-10-14' } ] },
}));
`);

/* ================= restaurants area ================= */
addSection('restaurants', `
__sopRoute('get', /^\\/food\\/restaurants\\/([^/]+)$/, (m) => ({
  restaurant: { id: m[1], name: 'Sop Kitchen', cuisine: 'Haitian', rating: 4.7 },
  menu: [ { id: 'sop-item-1', name: 'Griot Plate', price: 12.99 }, { id: 'sop-item-2', name: 'Rice and Beans', price: 8.99 } ],
}));
__sopRoute('get', /^\\/restaurants\\/kitchen\\/([^/]+)$/, (m) => ({
  tickets: [ { id: 'sop-tick-1', order_number: 'A12', status: 'new', items: [ { name: 'Griot Plate', qty: 2 } ] } ],
}));
__sopRoute('get', /^\\/restaurants\\/runner\\/([^/]+)$/, (m) => ({
  tasks: [ { id: 'sop-task-1', order_number: 'A12', status: 'offered', address: '123 Main St' } ],
}));
__sopRoute('get', /^\\/restaurants\\/pos\\/([^/]+)$/, (m) => ({
  items: [ { id: 'sop-item-1', name: 'Griot Plate', price: 12.99 } ],
}));
`);
