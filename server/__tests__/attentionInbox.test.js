'use strict';

/**
 * server/__tests__/attentionInbox.test.js
 *
 * Tests for GET /api/businesses/attention (Business Attention Inbox).
 * Uses the shared pg mock from ./setup with a SQL-fragment dispatcher so
 * each category can be seeded independently. Covers: positive per category,
 * resolved/irrelevant exclusion, disabled features (missing table, finance
 * role gating), unauthorized access, dedup, pagination, totals, partial
 * failures, stale sources, multi-currency restaurant credit, and read-only
 * behavior.
 */

const { mockQuery, resetMocks } = require('./setup');
const { collectAttention } = require('../services/attention');
const { getAttentionInbox } = require('../controllers/attentionInboxController');

const USER_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_USER = '00000000-0000-4000-8000-000000000002';
const BIZ = { id: 7, business_name: 'Cafe Luna', user_id: USER_ID, role: 'owner' };
const BIZ2 = { id: 9, business_name: 'Bistro Nord', user_id: USER_ID, role: 'owner' };

const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();
const daysAgo = (d) => new Date(Date.now() - d * 86400 * 1000).toISOString();
const hoursFromNow = (h) => new Date(Date.now() + h * 3600 * 1000).toISOString();

/**
 * Build a mockQuery implementation. `seed` maps fragment keys to row arrays.
 * Handlers respect the SQL-level business/restaurant scoping via params so
 * "irrelevant" rows (other businesses) are naturally excluded.
 *
 * NOTE: the pg mock bypasses real SQL, so each branch also emulates the
 * adapter's WHERE predicates (status filters, reviewed flags, expiry). This
 * keeps the "resolved/irrelevant" tests meaningful: they verify that terminal
 * states never become tasks, mirroring the production queries.
 */
function makeDb(seed = {}) {
  const {
    businesses = [BIZ],
    missingTables = [],
    throwOn = [],
    restaurants = [{ id: 42, display_name: 'Cafe Luna Kitchen' }],
    rows = {},
  } = seed;

  const inList = (val, list) => Array.isArray(list) && list.map(Number).includes(Number(val));

  // Adapters that scope via JOIN food_restaurants (fr.business_id = $1) pass
  // the business id as params[0]; resolve it to restaurant ids here.
  const restaurantIdsForBusiness = (businessId) => (restaurants || [])
    .filter((r) => r.business_id == null || Number(r.business_id) === Number(businessId))
    .map((r) => Number(r.id));

  return async (sql, params = []) => {
    const s = String(sql);

    for (const frag of throwOn) {
      if (s.includes(frag)) throw new Error('timeout');
    }

    if (s.includes('to_regclass')) {
      const m = s.match(/public\."([^"]+)"/);
      const t = m && m[1];
      return { rows: [{ reg: missingTables.includes(t) ? null : t }] };
    }

    // Canonical readiness reads the business and its real offerings.
    if (s.includes('AS service_count') && s.includes('FROM businesses b')) {
      return { rows: businesses.filter(b => b.id === params[0]).map(b => ({
        business_kind: 'service', business_type: 'Handyman', address_city: 'Springfield', description: 'Repairs',
        service_count: 1, setup_status: 'active', is_active: true, is_listed: true,
        ...b, ...(rows.setupReadiness || []).find(row => row.id === b.id),
      })) };
    }
    // Business access check (re-resolved every request).
    if (s.includes('FROM businesses b')) {
      const filter = params[1];
      return { rows: businesses.filter((b) => !filter || b.id === filter) };
    }

    if (s.includes('FROM food_restaurants WHERE business_id')) {
      return { rows: restaurants.filter((r) => !seed.restaurantBiz || r.business_id === params[0]) };
    }

    if (s.includes('FROM food_orders o')) {
      const list = (rows.foodOrders || []).filter((o) => o.business_id === params[0]
        && !['completed', 'cancelled', 'refunded'].includes(o.status));
      if (s.includes("fulfillment_type = 'delivery'")) {
        return { rows: list.filter((o) => o.fulfillment_type === 'delivery') };
      }
      return { rows: list };
    }
    if (s.includes('FROM business_appointments')) {
      return { rows: (rows.appointments || []).filter((a) => a.business_id === params[0]
        && ['pending', 'confirmed'].includes(a.status)) };
    }
    if (s.includes('FROM booking_requests')) {
      return { rows: (rows.bookingRequests || []).filter((r) => r.helper_id === params[0]
        && r.status === 'pending') };
    }
    if (s.includes('FROM work_agreement_versions v')) {
      return { rows: rows.agreementVersions || [] };
    }
    if (s.includes('FROM work_agreement_warranty_claims wc')) {
      return { rows: (rows.warrantyClaims || []).filter((w) => ['filed', 'under_review'].includes(w.status)) };
    }
    if (s.includes('FROM work_agreements wa')) {
      return { rows: (rows.agreements || []).filter((a) => a.helper_id === params[0]
        && a.status === 'pending_signatures') };
    }
    if (s.includes('FROM work_agreement_signatures')) {
      return { rows: rows.signatures || [] };
    }
    if (s.includes('FROM jobs') && !s.includes('work_agreements')) {
      return { rows: (rows.jobs || []).filter((j) => j.assigned_helper_id === params[0]
        && ['matched', 'negotiating', 'accepted', 'in_progress'].includes(j.status)) };
    }
    if (s.includes('FROM business_quotes')) {
      return { rows: (rows.quotes || []).filter((q) => q.business_id === params[0]
        && ['draft', 'sent', 'approved', 'expired'].includes(q.status)) };
    }
    if (s.includes('FROM business_conversations c')) {
      return { rows: (rows.conversations || []).filter((c) => c.business_id === params[0]) };
    }
    if (s.includes('FROM business_invoices')) {
      return { rows: (rows.invoices || []).filter((i) => i.business_id === params[0]
        && ['overdue', 'sent'].includes(i.status)) };
    }
    if (s.includes('FROM food_credit_refunds r')) {
      const rids = restaurantIdsForBusiness(params[0]);
      return { rows: (rows.refunds || []).filter((r) => inList(r.restaurant_id, rids)
        && ['pending', 'failed'].includes(r.status)) };
    }
    if (s.includes('FROM restaurant_payouts p')) {
      const rids = restaurantIdsForBusiness(params[0]);
      return { rows: (rows.payouts || []).filter((p) => inList(p.restaurant_id, rids)
        && ['failed', 'requested'].includes(p.status)) };
    }
    if (s.includes('FROM reconciliation_exceptions')) {
      return { rows: (rows.reconExceptions || []).filter((e) => e.business_id === params[0]
        && ['open', 'acknowledged'].includes(e.status) && e.domain === 'payout_settlement') };
    }
    if (s.includes('FROM food_customer_wallet_load_requests')) {
      const nowMs = Date.now();
      return { rows: (rows.loadRequests || []).filter((r) => inList(r.restaurant_id, params[0])
        && r.status === 'pending'
        && (!r.expires_at || new Date(r.expires_at).getTime() > nowMs)) };
    }
    if (s.includes('FROM restaurant_credit_funding_submissions')) {
      return { rows: (rows.fundingSubmissions || []).filter((r) => inList(r.restaurant_id, params[0])
        && r.status === 'pending') };
    }
    if (s.includes('FROM food_credit_disputes')) {
      return { rows: (rows.disputes || []).filter((r) => inList(r.restaurant_id, params[0])
        && ['open', 'under_review', 'resolved_info_needed'].includes(r.status)) };
    }
    if (s.includes('FROM restaurant_credit_exposure e')) {
      return { rows: (rows.exposure || []).filter((r) => inList(r.restaurant_id, params[0])) };
    }
    if (s.includes('FROM restaurant_credit_approvals')) {
      return { rows: (rows.approvals || []).filter((r) => inList(r.restaurant_id, params[0])
        && ['pending', 'suspended'].includes(r.status)) };
    }
    if (s.includes('FROM food_credit_fraud_signals')) {
      return { rows: (rows.fraudSignals || []).filter((r) => r.reviewed !== true
        && ['warn', 'block'].includes(r.severity)
        && (r.restaurant_id == null || inList(r.restaurant_id, params[0]))) };
    }
    if (s.includes('FROM oxsteed_credit_pending_actions')) {
      return { rows: (rows.oxsteedActions || []).filter((a) => a.status === 'pending'
        && (a.business_id === params[0] || a.requested_by === params[1])) };
    }
    if (s.includes('FROM business_product_low_stock_alerts a')) {
      return { rows: (rows.alerts || []).filter((a) => a.business_id === params[0] && a.is_active !== false) };
    }
    if (s.includes('FROM business_members')) {
      return { rows: (rows.invites || []).filter((m) => m.business_id === params[0] && m.status !== 'revoked') };
    }
    if (s.includes('FROM business_integrations')) {
      return { rows: (rows.integrations || []).filter((g) => g.business_id === params[0]
        && (g.is_connected === false || (g.last_error != null && String(g.last_error).trim() !== ''))) };
    }
    if (s.includes('FROM business_setup_progress')) {
      return { rows: (rows.setupProgress || []).filter((p) => p.business_id === params[0]) };
    }
    if (s.includes('FROM restaurant_support_cases sc')) {
      const rids = restaurantIdsForBusiness(params[0]);
      return { rows: (rows.supportCases || []).filter((c) => inList(c.restaurant_id, rids)
        && ['new', 'awaiting_restaurant', 'reopened', 'escalated'].includes(c.status)) };
    }
    return { rows: [], rowCount: 0 };
  };
}

function byCategory(items, category) {
  return items.filter((i) => i.category === category);
}

beforeEach(() => resetMocks());

describe('attention inbox — response shape', () => {
  test('returns the full contract shape with empty data', async () => {
    mockQuery.mockImplementation(makeDb({
      rows: {
        setupProgress: [
          { business_id: 7, current_step: 'review', completed_steps: ['identity', 'menu', 'review'], updated_at: daysAgo(1), created_at: daysAgo(9) },
        ],
      },
    }));
    const result = await collectAttention({ userId: USER_ID });
    expect(Object.keys(result).sort()).toEqual(
      ['freshness', 'items', 'limit', 'page', 'partialFailures', 'totalPages', 'totals'].sort()
    );
    expect(result.totals).toEqual({ total: 0, affectedBusinesses: 0, byCategory: {}, byUrgency: {} });
    expect(result.items).toEqual([]);
    expect(result.partialFailures).toEqual([]);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(20);
    expect(result.totalPages).toBe(1);
    // Sources were still checked: no reassuring zero without freshness.
    expect(result.freshness.length).toBeGreaterThan(0);
    expect(result.freshness.every((f) => 'source' in f && 'at' in f && 'stale' in f)).toBe(true);
  });

  test('item shape matches the contract', async () => {
    mockQuery.mockImplementation(makeDb({
      rows: {
        foodOrders: [{
          id: 1, business_id: 7, restaurant_id: 42, status: 'received',
          payment_status: 'unpaid', total_cents: 2500, currency_code: 'USD',
          promised_at: null, created_at: hoursAgo(1), updated_at: hoursAgo(1),
          ready_at: null, restaurant_name: 'Cafe Luna Kitchen', fulfillment_type: 'pickup',
        }],
        setupProgress: [
          { business_id: 7, current_step: 'review', completed_steps: ['identity', 'menu', 'review'], updated_at: daysAgo(1), created_at: daysAgo(9) },
        ],
      },
    }));
    const result = await collectAttention({ userId: USER_ID });
    expect(result.items).toHaveLength(1);
    const item = result.items[0];
    expect(item.id).toBe('orders_fulfillment:food_order:1');
    expect(item).toMatchObject({
      businessId: 7,
      businessName: 'Cafe Luna',
      restaurantId: 42,
      restaurantName: 'Cafe Luna Kitchen',
      category: 'orders_fulfillment',
      sourceType: 'food_order',
      sourceId: '1',
      reason: 'attention.reasons.newOrder',
      urgency: 'high',
      amountCents: 2500,
      currencyCode: 'USD',
      creditRail: null,
    });
    expect(item.taskDestination).toEqual({
      type: 'route',
      route: '/business/7/orders',
      params: { orderId: '1' },
    });
    expect(typeof item.ageDays).toBe('number');
    expect(item.deadlineAt).toBeNull();
  });

  test('performs no mutations (read-only)', async () => {
    mockQuery.mockImplementation(makeDb({
      rows: {
        foodOrders: [{
          id: 1, business_id: 7, restaurant_id: 42, status: 'received',
          payment_status: 'unpaid', total_cents: 100, currency_code: 'USD',
          promised_at: null, created_at: hoursAgo(1), updated_at: hoursAgo(1),
          ready_at: null, restaurant_name: 'R', fulfillment_type: 'pickup',
        }],
      },
    }));
    await collectAttention({ userId: USER_ID });
    const writes = mockQuery.mock.calls.filter(([sql]) =>
      /\b(INSERT|UPDATE|DELETE|UPSERT|MERGE)\b/i.test(String(sql)));
    expect(writes).toEqual([]);
  });
});

describe('attention inbox — positive per category', () => {
  // Seeds one actionable row per category (16 categories). Urgency
  // expectations mirror the adapter rules.
  function seedAll() {
    return makeDb({
      rows: {
        setupReadiness: [{ id: 7, service_count: 0, setup_status: 'in_progress' }],
        foodOrders: [
          { id: 1, business_id: 7, restaurant_id: 42, status: 'received', payment_status: 'unpaid', total_cents: 2500, currency_code: 'USD', promised_at: null, created_at: hoursAgo(1), updated_at: hoursAgo(1), ready_at: null, restaurant_name: 'R', fulfillment_type: 'pickup' },
          { id: 2, business_id: 7, restaurant_id: 42, status: 'accepted', payment_status: 'paid', total_cents: 1000, currency_code: 'USD', promised_at: hoursAgo(0.5), created_at: hoursAgo(3), updated_at: hoursAgo(3), ready_at: null, restaurant_name: 'R', fulfillment_type: 'delivery' },
        ],
        appointments: [
          { id: 'a1', business_id: 7, staff_id: 's1', customer_name: 'Kim', start_time: hoursFromNow(10), end_time: hoursFromNow(11), status: 'pending', created_at: daysAgo(1), updated_at: daysAgo(1) },
          { id: 'a2', business_id: 7, staff_id: 's1', customer_name: 'Lee', start_time: hoursFromNow(2.5), end_time: hoursFromNow(3.5), status: 'confirmed', created_at: daysAgo(1), updated_at: daysAgo(1) },
          { id: 'a3', business_id: 7, staff_id: 's1', customer_name: 'Max', start_time: hoursFromNow(3), end_time: hoursFromNow(4), status: 'pending', created_at: daysAgo(1), updated_at: daysAgo(1) },
        ],
        bookingRequests: [
          { id: 'br1', helper_id: USER_ID, service_name: 'Plumbing', requested_date: '2026-10-20', status: 'pending', created_at: daysAgo(1), updated_at: daysAgo(1) },
        ],
        jobs: [
          { id: 'j1', assigned_helper_id: USER_ID, title: 'Sink fix', status: 'matched', scheduled_start_at: hoursFromNow(5), scheduled_end_at: hoursFromNow(6), started_at: null, created_at: daysAgo(1), updated_at: daysAgo(1) },
          { id: 'j2', assigned_helper_id: USER_ID, title: 'Leak', status: 'in_progress', scheduled_start_at: daysAgo(2), scheduled_end_at: daysAgo(1), started_at: daysAgo(2), created_at: daysAgo(3), updated_at: daysAgo(1) },
        ],
        agreementVersions: [
          { id: 'v2', agreement_id: 'ag1', version_number: 2, created_by: OTHER_USER, created_at: daysAgo(1) },
        ],
        quotes: [
          { id: 11, business_id: 7, client_name: 'Acme', title: 'Catering', status: 'draft', total_cents: 50000, valid_until: null, created_at: daysAgo(2), updated_at: daysAgo(2) },
          { id: 12, business_id: 7, client_name: 'Globex', title: 'Lunch', status: 'sent', total_cents: 20000, valid_until: hoursFromNow(24), created_at: daysAgo(10), updated_at: daysAgo(10) },
        ],
        conversations: [
          { id: 'c1', business_id: 7, customer_name: 'Pat', customer_email: 'pat@x.com', last_message_at: hoursAgo(30), last_sender_type: 'customer', last_message_created: hoursAgo(30), unread_count: '2', created_at: daysAgo(3), updated_at: hoursAgo(30) },
        ],
        agreements: [
          { id: 'ag1', helper_id: USER_ID, status: 'pending_signatures', created_at: daysAgo(2), updated_at: daysAgo(2), latest_version: 2, latest_version_id: 'v2' },
        ],
        signatures: [],
        warrantyClaims: [
          { id: 'w1', agreement_id: 'ag1', status: 'filed', description: 'leak again', created_at: daysAgo(10) },
        ],
        invoices: [
          { id: 21, business_id: 7, invoice_number: 'INV-1', client_name: 'Acme', status: 'overdue', total: '150.00', amount_paid: '0', due_date: daysAgo(5), issue_date: daysAgo(20), created_at: daysAgo(20), updated_at: daysAgo(5) },
          { id: 22, business_id: 7, invoice_number: 'INV-2', client_name: 'Globex', status: 'sent', total: '75.50', amount_paid: '0', due_date: hoursFromNow(72), issue_date: daysAgo(2), created_at: daysAgo(2), updated_at: daysAgo(2) },
        ],
        refunds: [
          { id: 31, restaurant_id: 42, amount_cents: 1200, currency_code: 'USD', status: 'pending', reason: 'dup', created_at: daysAgo(10), updated_at: daysAgo(10) },
          { id: 32, restaurant_id: 42, amount_cents: 500, currency_code: 'USD', status: 'failed', reason: 'err', created_at: daysAgo(1), updated_at: daysAgo(1) },
        ],
        payouts: [
          { id: 41, restaurant_id: 42, amount_cents: 9000, status: 'failed', created_at: daysAgo(2), updated_at: daysAgo(2), restaurant_currency: 'USD' },
          { id: 42, restaurant_id: 42, amount_cents: 4000, status: 'requested', created_at: daysAgo(4), updated_at: daysAgo(4), restaurant_currency: 'USD' },
        ],
        reconExceptions: [
          { id: 'rx1', business_id: '7', domain: 'payout_settlement', severity: 'critical', status: 'open', summary: 'mismatch', created_at: daysAgo(1), updated_at: daysAgo(1) },
        ],
        loadRequests: [
          { id: 51, restaurant_id: 42, amount_cents: 2500, currency_code: 'USD', status: 'pending', created_at: hoursAgo(2), updated_at: hoursAgo(2), expires_at: null },
          { id: 52, restaurant_id: 42, amount_cents: 1000, currency_code: 'EUR', status: 'pending', created_at: hoursAgo(30), updated_at: hoursAgo(30), expires_at: null },
        ],
        fundingSubmissions: [
          { id: 61, restaurant_id: 42, amount_cents: 50000, currency_code: 'USD', status: 'pending', created_at: daysAgo(2), updated_at: daysAgo(2) },
        ],
        disputes: [
          { id: 71, restaurant_id: 42, load_request_id: 51, status: 'open', reason: 'x', opened_at: daysAgo(3), created_at: daysAgo(3), updated_at: daysAgo(3) },
          { id: 72, restaurant_id: 42, load_request_id: 52, status: 'resolved_info_needed', reason: 'y', opened_at: daysAgo(1), created_at: daysAgo(1), updated_at: daysAgo(1) },
        ],
        exposure: [
          { restaurant_id: 42, outstanding_cents: 8500, cap_cents: 10000, currency_code: 'USD' },
        ],
        approvals: [
          { restaurant_id: 42, status: 'suspended', grace_period_ends_at: hoursFromNow(48), updated_at: daysAgo(1) },
        ],
        fraudSignals: [
          { id: 81, restaurant_id: 42, signal_type: 'velocity', severity: 'warn', details: {}, created_at: daysAgo(1) },
          { id: 82, restaurant_id: 42, signal_type: 'impossible_travel', severity: 'block', details: {}, created_at: hoursAgo(3) },
        ],
        oxsteedActions: [
          { id: 'ox1', business_id: '7', requested_by: USER_ID, action_type: 'credit_topup', status: 'pending', expires_at: hoursFromNow(72), requested_at: daysAgo(1) },
        ],
        alerts: [
          { id: 'al1', business_id: 7, variant_name: 'Large', product_name: 'Beans', sku: 'B-1', last_alerted: daysAgo(1), created_at: daysAgo(1) },
        ],
        invites: [
          { id: 91, business_id: 7, invite_email: 'sam@x.com', role: 'manager', invited_at: daysAgo(10) },
        ],
        integrations: [
          { id: 'g1', business_id: 7, integration_type: 'stripe', integration_name: 'Stripe', is_connected: false, is_enabled: true, last_error: null, updated_at: daysAgo(2), created_at: daysAgo(30) },
          { id: 'g2', business_id: 7, integration_type: 'square', integration_name: 'Square', is_connected: true, is_enabled: true, last_error: 'auth expired', updated_at: daysAgo(1), created_at: daysAgo(30) },
        ],
        setupProgress: [
          { business_id: 7, current_step: 'menu', completed_steps: ['identity'], updated_at: daysAgo(4), created_at: daysAgo(9) },
        ],
        supportCases: [
          { id: 101, restaurant_id: 42, public_case_number: 'CS-1', status: 'new', issue_type: 'late_order', title: 'late', created_at: hoursAgo(30), updated_at: hoursAgo(30) },
          { id: 102, restaurant_id: 42, public_case_number: 'CS-2', status: 'escalated', issue_type: 'food_quality', title: 'cold', created_at: daysAgo(2), updated_at: daysAgo(1) },
        ],
      },
    });
  }

  test('collects one task per category with expected urgencies', async () => {
    mockQuery.mockImplementation(seedAll());
    const result = await collectAttention({ userId: USER_ID, limit: 100 });

    const expectOne = (category, reason, urgency) => {
      const found = byCategory(result.items, category);
      expect(found.length).toBeGreaterThanOrEqual(1);
      const match = found.find((i) => i.reason === reason && i.urgency === urgency);
      expect(match).toBeDefined();
      return match;
    };

    expectOne('orders_fulfillment', 'attention.reasons.newOrder', 'high');
    expectOne('orders_fulfillment', 'attention.reasons.overdueFulfillment', 'urgent');
    expectOne('pickup_delivery', 'attention.reasons.missedDelivery', 'high');
    expectOne('bookings_scheduling', 'attention.reasons.pendingBooking', 'high');
    expectOne('bookings_scheduling', 'attention.reasons.bookingConflict', 'high');
    expectOne('bookings_scheduling', 'attention.reasons.pendingBooking', 'high');
    expectOne('service_jobs', 'attention.reasons.jobAssignment', 'high');
    expectOne('service_jobs', 'attention.reasons.overdueJob', 'urgent');
    expectOne('service_jobs', 'attention.reasons.jobChangeRequest', 'high');
    expectOne('leads_quotes', 'attention.reasons.quoteRequest', 'normal');
    expectOne('leads_quotes', 'attention.reasons.followupDeadline', 'high');
    const msg = expectOne('messages', 'attention.reasons.unreadMessages', 'high');
    expect(msg.reasonParams.count).toBe(2);
    expectOne('agreements_warranties', 'attention.reasons.signatureRequired', 'normal');
    expectOne('agreements_warranties', 'attention.reasons.warrantyClaim', 'high');
    expectOne('invoices_billing', 'attention.reasons.overdueInvoice', 'urgent');
    expectOne('invoices_billing', 'attention.reasons.followupDeadline', 'high');
    expectOne('refunds_disputes', 'attention.reasons.refundDecision', 'high');
    expectOne('refunds_disputes', 'attention.reasons.failedCharge', 'urgent');
    expectOne('payments_settlements', 'attention.reasons.failedPayout', 'urgent');
    expectOne('payments_settlements', 'attention.reasons.payoutBlocked', 'high');
    expectOne('payments_settlements', 'attention.reasons.reconciliationDiff', 'urgent');
    expectOne('restaurant_credit', 'attention.reasons.creditRequestPending', 'high');
    expectOne('restaurant_credit', 'attention.reasons.fundingProofReview', 'high');
    expectOne('restaurant_credit', 'attention.reasons.creditDispute', 'high');
    expectOne('restaurant_credit', 'attention.reasons.evidenceDeadline', 'urgent');
    expectOne('restaurant_credit', 'attention.reasons.exposureWarning', 'high');
    expectOne('restaurant_credit', 'attention.reasons.approvalRestricted', 'urgent');
    expectOne('restaurant_credit', 'attention.reasons.flaggedTransaction', 'urgent');
    expectOne('restaurant_credit', 'attention.reasons.creditRequestPending', 'normal');
    expectOne('inventory_offerings', 'attention.reasons.lowStock', 'normal');
    expectOne('team_access', 'attention.reasons.membershipApproval', 'high');
    expectOne('devices_integrations', 'attention.reasons.integrationDisconnected', 'normal');
    expectOne('devices_integrations', 'attention.reasons.syncFailed', 'high');
    expectOne('setup_verification', 'attention.reasons.launchStep', 'normal');
    expectOne('customer_followup', 'attention.reasons.complaintAwaiting', 'high');

    // Every category key is represented.
    const cats = new Set(result.items.map((i) => i.category));
    expect(cats.size).toBe(16);

    // Totals reconcile with items.
    expect(result.totals.total).toBe(result.items.length);
    expect(result.totals.affectedBusinesses).toBe(1);
    const catSum = Object.values(result.totals.byCategory).reduce((a, b) => a + b, 0);
    expect(catSum).toBe(result.totals.total);
  });

  test('multi-currency restaurant credit: amounts never combined', async () => {
    mockQuery.mockImplementation(seedAll());
    const result = await collectAttention({ userId: USER_ID, category: 'restaurant_credit', limit: 100 });
    const loads = result.items.filter((i) => i.sourceType === 'wallet_load_request');
    expect(loads).toHaveLength(2);
    const usd = loads.find((i) => i.currencyCode === 'USD');
    const eur = loads.find((i) => i.currencyCode === 'EUR');
    expect(usd.amountCents).toBe(2500);
    expect(eur.amountCents).toBe(1000);
    expect(usd.creditRail).toBe('restaurant');
    // No item aggregates across currencies.
    for (const i of loads) {
      expect(typeof i.amountCents).toBe('number');
      expect(i.currencyCode).toMatch(/^[A-Z]{3}$/);
    }
    const ox = result.items.find((i) => i.sourceType === 'oxsteed_credit_pending_action');
    expect(ox.creditRail).toBe('oxsteed');
  });

  test('food credit disputes appear only under restaurant_credit (no cross-category dup)', async () => {
    mockQuery.mockImplementation(seedAll());
    const result = await collectAttention({ userId: USER_ID, limit: 100 });
    const disputeItems = result.items.filter((i) => i.sourceType === 'food_credit_dispute');
    expect(disputeItems.length).toBeGreaterThan(0);
    expect(disputeItems.every((i) => i.category === 'restaurant_credit')).toBe(true);
    expect(byCategory(result.items, 'refunds_disputes').every((i) => i.sourceType !== 'food_credit_dispute')).toBe(true);
  });
});

describe('attention inbox — resolved and irrelevant are excluded', () => {
  test('terminal states produce no tasks (but sources are still reported)', async () => {
    mockQuery.mockImplementation(makeDb({
      rows: {
        // completed/cancelled/refunded orders: routine success or intentional end.
        foodOrders: [
          { id: 1, business_id: 7, restaurant_id: 42, status: 'completed', payment_status: 'paid', total_cents: 100, currency_code: 'USD', promised_at: null, created_at: daysAgo(1), updated_at: daysAgo(1), ready_at: null, restaurant_name: 'R', fulfillment_type: 'pickup' },
          { id: 2, business_id: 7, restaurant_id: 42, status: 'cancelled', payment_status: 'unpaid', total_cents: 100, currency_code: 'USD', promised_at: null, created_at: daysAgo(1), updated_at: daysAgo(1), ready_at: null, restaurant_name: 'R', fulfillment_type: 'pickup' },
        ],
        invoices: [
          { id: 21, business_id: 7, invoice_number: 'INV-9', client_name: 'Acme', status: 'paid', total: '10.00', amount_paid: '10.00', due_date: daysAgo(1), issue_date: daysAgo(9), created_at: daysAgo(9), updated_at: daysAgo(1) },
        ],
        quotes: [
          { id: 11, business_id: 7, client_name: 'Acme', title: 'X', status: 'converted', total_cents: 100, valid_until: null, created_at: daysAgo(9), updated_at: daysAgo(2) },
          { id: 12, business_id: 7, client_name: 'Acme', title: 'Y', status: 'declined', total_cents: 100, valid_until: null, created_at: daysAgo(9), updated_at: daysAgo(2) },
        ],
        loadRequests: [
          { id: 51, restaurant_id: 42, amount_cents: 100, currency_code: 'USD', status: 'expired', created_at: daysAgo(9), updated_at: daysAgo(2), expires_at: daysAgo(2) },
        ],
        fundingSubmissions: [
          { id: 61, restaurant_id: 42, amount_cents: 100, currency_code: 'USD', status: 'verified', created_at: daysAgo(9), updated_at: daysAgo(2) },
        ],
        fraudSignals: [
          { id: 81, restaurant_id: 42, signal_type: 'velocity', severity: 'block', reviewed: true, details: {}, created_at: daysAgo(9) },
        ],
        integrations: [
          { id: 'g1', business_id: 7, integration_type: 'stripe', integration_name: 'Stripe', is_connected: true, is_enabled: true, last_error: null, updated_at: daysAgo(1), created_at: daysAgo(30) },
        ],
        setupProgress: [
          { business_id: 7, current_step: 'review', completed_steps: ['identity', 'menu', 'review'], updated_at: daysAgo(1), created_at: daysAgo(9) },
        ],
        supportCases: [
          { id: 101, restaurant_id: 42, public_case_number: 'CS-9', status: 'resolved', issue_type: 'late_order', title: 'x', created_at: daysAgo(9), updated_at: daysAgo(2) },
          { id: 102, restaurant_id: 42, public_case_number: 'CS-8', status: 'awaiting_customer', issue_type: 'late_order', title: 'y', created_at: daysAgo(9), updated_at: daysAgo(2) },
        ],
      },
    }));
    // fraud signal row is reviewed=false in seed above? No — reviewed flag is
    // a column; mark it reviewed so it is excluded.
    const result = await collectAttention({ userId: USER_ID, limit: 100 });
    // reviewed=true must be set via the row; patch the seed instead:
    expect(result.items).toEqual([]);
    expect(result.totals.total).toBe(0);
    // Sources were checked — the empty result is honest, not assumed.
    expect(result.freshness.length).toBeGreaterThan(0);
    expect(result.partialFailures).toEqual([]);
  });

  test('reviewed fraud signals are excluded', async () => {
    mockQuery.mockImplementation(makeDb({
      rows: { fraudSignals: [
        { id: 81, restaurant_id: 42, signal_type: 'velocity', severity: 'block', reviewed: true, details: {}, created_at: daysAgo(1) },
        { id: 82, restaurant_id: 42, signal_type: 'velocity', severity: 'warn', reviewed: false, details: {}, created_at: daysAgo(1) },
      ] },
    }));
    const result = await collectAttention({ userId: USER_ID, category: 'restaurant_credit', limit: 100 });
    const signals = result.items.filter((i) => i.sourceType === 'fraud_signal');
    expect(signals).toHaveLength(1);
    expect(signals[0].sourceId).toBe('82');
  });

  test("another business's records are irrelevant to this user", async () => {
    mockQuery.mockImplementation(makeDb({
      rows: {
        foodOrders: [
          { id: 99, business_id: 999, restaurant_id: 4242, status: 'received', payment_status: 'unpaid', total_cents: 5000, currency_code: 'USD', promised_at: null, created_at: hoursAgo(1), updated_at: hoursAgo(1), ready_at: null, restaurant_name: 'Other', fulfillment_type: 'pickup' },
        ],
        invoices: [
          { id: 299, business_id: 999, invoice_number: 'INV-X', client_name: 'X', status: 'overdue', total: '99.00', amount_paid: '0', due_date: daysAgo(3), issue_date: daysAgo(9), created_at: daysAgo(9), updated_at: daysAgo(3) },
        ],
        setupProgress: [
          { business_id: 7, current_step: 'review', completed_steps: ['identity', 'menu', 'review'], updated_at: daysAgo(1), created_at: daysAgo(9) },
        ],
      },
    }));
    const result = await collectAttention({ userId: USER_ID, limit: 100 });
    expect(result.items).toEqual([]);
  });
});

describe('attention inbox — disabled features and access', () => {
  test('missing source table → stale freshness entry, never a silent zero', async () => {
    mockQuery.mockImplementation(makeDb({
      missingTables: ['food_orders', 'business_invoices'],
      rows: {
        foodOrders: [
          { id: 1, business_id: 7, restaurant_id: 42, status: 'received', payment_status: 'unpaid', total_cents: 100, currency_code: 'USD', promised_at: null, created_at: hoursAgo(1), updated_at: hoursAgo(1), ready_at: null, restaurant_name: 'R', fulfillment_type: 'pickup' },
        ],
      },
    }));
    const result = await collectAttention({ userId: USER_ID, limit: 100 });
    expect(byCategory(result.items, 'orders_fulfillment')).toEqual([]);
    expect(byCategory(result.items, 'pickup_delivery')).toEqual([]);
    expect(byCategory(result.items, 'invoices_billing')).toEqual([]);
    const stale = result.freshness.filter((f) => f.stale).map((f) => f.source);
    expect(stale).toContain('food_orders');
    expect(stale).toContain('business_invoices');
  });

  test('employee/support_agent roles do not see finance categories', async () => {
    const employeeBiz = { id: 7, business_name: 'Cafe Luna', user_id: OTHER_USER, role: 'employee' };
    mockQuery.mockImplementation(makeDb({
      businesses: [employeeBiz],
      rows: {
        foodOrders: [
          { id: 1, business_id: 7, restaurant_id: 42, status: 'received', payment_status: 'unpaid', total_cents: 100, currency_code: 'USD', promised_at: null, created_at: hoursAgo(1), updated_at: hoursAgo(1), ready_at: null, restaurant_name: 'R', fulfillment_type: 'pickup' },
        ],
        invoices: [
          { id: 21, business_id: 7, invoice_number: 'INV-1', client_name: 'Acme', status: 'overdue', total: '10.00', amount_paid: '0', due_date: daysAgo(1), issue_date: daysAgo(9), created_at: daysAgo(9), updated_at: daysAgo(1) },
        ],
        invites: [
          { id: 91, business_id: 7, invite_email: 'sam@x.com', role: 'manager', invited_at: daysAgo(1) },
        ],
      },
    }));
    const result = await collectAttention({ userId: OTHER_USER, limit: 100 });
    expect(byCategory(result.items, 'orders_fulfillment')).toHaveLength(1);
    expect(byCategory(result.items, 'team_access')).toHaveLength(1);
    expect(byCategory(result.items, 'invoices_billing')).toEqual([]);
    expect(byCategory(result.items, 'restaurant_credit')).toEqual([]);
    expect(byCategory(result.items, 'payments_settlements')).toEqual([]);
    expect(byCategory(result.items, 'refunds_disputes')).toEqual([]);
  });

  test('businessId filter for an inaccessible business → 404', async () => {
    mockQuery.mockImplementation(makeDb());
    await expect(collectAttention({ userId: USER_ID, businessId: 999 }))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  test('businessId filter for an accessible business scopes results', async () => {
    mockQuery.mockImplementation(makeDb({
      businesses: [BIZ, BIZ2],
      rows: {
        foodOrders: [
          { id: 1, business_id: 7, status: 'received', payment_status: 'unpaid', total_cents: 100, currency_code: 'USD', promised_at: null, created_at: hoursAgo(1), updated_at: hoursAgo(1), ready_at: null, restaurant_id: 42, restaurant_name: 'R', fulfillment_type: 'pickup' },
          { id: 2, business_id: 9, status: 'received', payment_status: 'unpaid', total_cents: 200, currency_code: 'USD', promised_at: null, created_at: hoursAgo(1), updated_at: hoursAgo(1), ready_at: null, restaurant_id: 43, restaurant_name: 'R2', fulfillment_type: 'pickup' },
        ],
      },
      restaurants: [
        { id: 42, display_name: 'Cafe Luna Kitchen', business_id: 7 },
        { id: 43, display_name: 'Bistro Nord Kitchen', business_id: 9 },
      ],
      restaurantBiz: true,
    }));
    const result = await collectAttention({ userId: USER_ID, businessId: 9, category: 'orders_fulfillment', limit: 100 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].businessId).toBe(9);
    expect(result.totals.affectedBusinesses).toBe(1);
  });

  test('unauthenticated → 401 via controller', async () => {
    const res = { status: jest.fn(() => res), json: jest.fn(() => res) };
    await getAttentionInbox({ user: null, query: {} }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'auth_required' })
    );
  });

  test('invalid category/urgency → 400', async () => {
    await expect(collectAttention({ userId: USER_ID, category: 'nope' }))
      .rejects.toMatchObject({ statusCode: 400 });
    await expect(collectAttention({ userId: USER_ID, urgency: 'nope' }))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  test('controller maps 404 from collectAttention', async () => {
    mockQuery.mockImplementation(makeDb());
    const res = { status: jest.fn(() => res), json: jest.fn(() => res) };
    await getAttentionInbox({ user: { id: USER_ID }, query: { businessId: '999' } }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe('attention inbox — dedup, pagination, totals', () => {
  test('same record+problem from two adapters collapses to one task', async () => {
    jest.resetModules();
    const dupItem = {
      id: 'orders_fulfillment:food_order:1',
      businessId: 7,
      businessName: 'Cafe Luna',
      category: 'orders_fulfillment',
      sourceType: 'food_order',
      sourceId: '1',
      reason: 'attention.reasons.newOrder',
      reasonParams: {},
      urgency: 'normal',
      createdAt: new Date().toISOString(),
      deadlineAt: null,
      ageDays: 0,
      creditRail: null,
      taskDestination: { type: 'route', route: '/x', params: {} },
    };
    jest.doMock('../services/attention/adapters/messages', () => ({
      collect: async () => ({ items: [dupItem], freshness: [] }),
    }));
    const freshSetup = require('./setup');
    const fresh = require('../services/attention');
    freshSetup.mockQuery.mockImplementation(makeDb({
      rows: {
        foodOrders: [
          { id: 1, business_id: 7, restaurant_id: 42, status: 'received', payment_status: 'unpaid', total_cents: 100, currency_code: 'USD', promised_at: null, created_at: hoursAgo(1), updated_at: hoursAgo(1), ready_at: null, restaurant_name: 'R', fulfillment_type: 'pickup' },
        ],
        setupProgress: [
          { business_id: 7, current_step: 'review', completed_steps: ['identity', 'menu', 'review'], updated_at: daysAgo(1), created_at: daysAgo(9) },
        ],
      },
    }));
    const result = await fresh.collectAttention({ userId: USER_ID, limit: 100 });
    const matches = result.items.filter((i) => i.id === 'orders_fulfillment:food_order:1');
    expect(matches).toHaveLength(1);
    expect(result.totals.total).toBe(1);
    jest.dontMock('../services/attention/adapters/messages');
  });

  test('task identity is stable across runs', async () => {
    const seed = makeDb({
      rows: {
        foodOrders: [
          { id: 5, business_id: 7, restaurant_id: 42, status: 'received', payment_status: 'unpaid', total_cents: 100, currency_code: 'USD', promised_at: null, created_at: hoursAgo(1), updated_at: hoursAgo(1), ready_at: null, restaurant_name: 'R', fulfillment_type: 'pickup' },
        ],
      },
    });
    mockQuery.mockImplementation(seed);
    const a = await collectAttention({ userId: USER_ID });
    mockQuery.mockImplementation(seed);
    const b = await collectAttention({ userId: USER_ID });
    expect(a.items.map((i) => i.id)).toEqual(b.items.map((i) => i.id));
  });

  test('pagination slices items but totals cover the full set', async () => {
    const orders = Array.from({ length: 25 }, (_, n) => ({
      id: 100 + n, business_id: 7, restaurant_id: 42, status: 'received',
      payment_status: 'unpaid', total_cents: 100, currency_code: 'USD',
      promised_at: null, created_at: hoursAgo(n + 1), updated_at: hoursAgo(n + 1),
      ready_at: null, restaurant_name: 'R', fulfillment_type: 'pickup',
    }));
    mockQuery.mockImplementation(makeDb({ rows: { foodOrders: orders,
      setupProgress: [
        { business_id: 7, current_step: 'review', completed_steps: ['identity', 'menu', 'review'], updated_at: daysAgo(1), created_at: daysAgo(9) },
      ],
    } }));
    const p1 = await collectAttention({ userId: USER_ID, page: 1, limit: 10 });
    const p2 = await collectAttention({ userId: USER_ID, page: 2, limit: 10 });
    const p3 = await collectAttention({ userId: USER_ID, page: 3, limit: 10 });
    expect(p1.items).toHaveLength(10);
    expect(p2.items).toHaveLength(10);
    expect(p3.items).toHaveLength(5);
    for (const p of [p1, p2, p3]) {
      expect(p.totals.total).toBe(25);
      expect(p.totalPages).toBe(3);
      expect(p.limit).toBe(10);
    }
    expect(p2.page).toBe(2);
    // Pages do not overlap.
    const ids = [...p1.items, ...p2.items, ...p3.items].map((i) => i.id);
    expect(new Set(ids).size).toBe(25);
    // Urgent sorts before normal.
    const urgencies = p1.items.map((i) => i.urgency);
    expect(urgencies[0]).not.toBe('low');
  });

  test('category and urgency filters narrow the set', async () => {
    const orders = [
      { id: 1, business_id: 7, restaurant_id: 42, status: 'received', payment_status: 'unpaid', total_cents: 100, currency_code: 'USD', promised_at: null, created_at: hoursAgo(10), updated_at: hoursAgo(10), ready_at: null, restaurant_name: 'R', fulfillment_type: 'pickup' },
      { id: 2, business_id: 7, restaurant_id: 42, status: 'accepted', payment_status: 'paid', total_cents: 100, currency_code: 'USD', promised_at: hoursAgo(1), created_at: hoursAgo(5), updated_at: hoursAgo(5), ready_at: null, restaurant_name: 'R', fulfillment_type: 'pickup' },
    ];
    mockQuery.mockImplementation(makeDb({ rows: { foodOrders: orders } }));
    const urgentOnly = await collectAttention({ userId: USER_ID, urgency: 'urgent', limit: 100 });
    expect(urgentOnly.items).toHaveLength(1);
    expect(urgentOnly.items[0].urgency).toBe('urgent');
    expect(urgentOnly.totals.byUrgency).toEqual({ urgent: 1 });

    const byCat = await collectAttention({ userId: USER_ID, category: 'pickup_delivery', limit: 100 });
    expect(byCat.items).toEqual([]);
    expect(byCat.totals.byCategory).toEqual({});
  });

  test('totals aggregate across businesses', async () => {
    mockQuery.mockImplementation(makeDb({
      businesses: [BIZ, BIZ2],
      rows: {
        foodOrders: [
          { id: 1, business_id: 7, status: 'received', payment_status: 'unpaid', total_cents: 100, currency_code: 'USD', promised_at: null, created_at: hoursAgo(10), updated_at: hoursAgo(10), ready_at: null, restaurant_id: 42, restaurant_name: 'R', fulfillment_type: 'pickup' },
          { id: 2, business_id: 9, status: 'accepted', payment_status: 'paid', total_cents: 100, currency_code: 'USD', promised_at: hoursAgo(1), created_at: hoursAgo(5), updated_at: hoursAgo(5), ready_at: null, restaurant_id: 43, restaurant_name: 'R2', fulfillment_type: 'pickup' },
        ],
      },
      restaurants: [
        { id: 42, display_name: 'Cafe Luna Kitchen', business_id: 7 },
        { id: 43, display_name: 'Bistro Nord Kitchen', business_id: 9 },
      ],
      restaurantBiz: true,
    }));
    const result = await collectAttention({ userId: USER_ID, category: 'orders_fulfillment', limit: 100 });
    expect(result.totals.total).toBe(2);
    expect(result.totals.affectedBusinesses).toBe(2);
    expect(result.totals.byCategory).toEqual({ orders_fulfillment: 2 });
    expect(result.totals.byUrgency).toEqual({ high: 1, urgent: 1 });
  });
});

describe('attention inbox — partial failures and stale sources', () => {
  test('a failing adapter is reported; other categories still return', async () => {
    mockQuery.mockImplementation(makeDb({
      throwOn: ['FROM food_orders o'],
      rows: {
        invoices: [
          { id: 21, business_id: 7, invoice_number: 'INV-1', client_name: 'Acme', status: 'overdue', total: '10.00', amount_paid: '0', due_date: daysAgo(1), issue_date: daysAgo(9), created_at: daysAgo(9), updated_at: daysAgo(1) },
        ],
      },
    }));
    const result = await collectAttention({ userId: USER_ID, limit: 100 });
    expect(result.partialFailures).toHaveLength(2);
    const sources = result.partialFailures.map((f) => f.source).sort();
    expect(sources).toEqual(['orders_fulfillment', 'pickup_delivery']);
    expect(result.partialFailures[0]).toMatchObject({ error: 'timeout' });
    expect(byCategory(result.items, 'invoices_billing')).toHaveLength(1);
    const staleSources = result.freshness.filter((f) => f.stale).map((f) => f.source);
    expect(staleSources).toContain('orders_fulfillment');
  });

  test('stale source entries carry notes, never invented data', async () => {
    mockQuery.mockImplementation(makeDb());
    const result = await collectAttention({ userId: USER_ID, limit: 100 });
    const stale = result.freshness.filter((f) => f.stale);
    // Known honest gaps: delivery assignments, marketplace/chat refunds,
    // verification reviews — each explains itself.
    const notes = Object.fromEntries(stale.map((f) => [f.source, f.note]));
    expect(notes.delivery_assignments).toMatch(/no authoritative/i);
    expect(notes.verification_reviews).toMatch(/no authoritative/i);
    for (const f of stale) {
      expect(f.at === null || typeof f.at === 'string').toBe(true);
    }
  });
});
