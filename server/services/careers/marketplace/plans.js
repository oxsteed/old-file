'use strict';

// Employer subscription plans (docs/careers/marketplace.md §10.1). Off
// unless CAREERS_PLANS_ENABLED=true with Stripe configured and the plan
// price ids set. Posting jobs, messaging, scheduling and screeners stay
// free on every plan; plans raise limits on sourcing tools. While plans
// are off, every business gets the "unlimited" entitlements, so turning
// the flag on never breaks an existing workflow mid-hire.
//   • Stripe Checkout in subscription mode with a one-time free trial per
//     business (CAREERS_PLAN_TRIAL_DAYS, default 14).
//   • Stripe Billing Portal for card changes and cancellation.
//   • Webhooks (shared /api/careers/webhooks/stripe endpoint, signature
//     checked) are de-duplicated in career_stripe_events and drive status.

const { AppError } = require('../../../middleware/errorHandler');
const { PLANS } = require('../../careerCatalog');
const { plansConfig } = require('../providers/config');
const { featureOff } = require('./common');
const referrals = require('./referrals');

const ENTITLEMENTS = Object.freeze({
  free: { candidate_alerts: 1, shortlists: 1, talent_invites_per_month: 25, analytics_export: false, agency_clients: 0 },
  starter: { candidate_alerts: 5, shortlists: 5, talent_invites_per_month: 100, analytics_export: true, agency_clients: 0 },
  growth: { candidate_alerts: 20, shortlists: 20, talent_invites_per_month: 400, analytics_export: true, agency_clients: 5 },
  pro: { candidate_alerts: 100, shortlists: 100, talent_invites_per_month: 2000, analytics_export: true, agency_clients: 50 },
});
const UNLIMITED = Object.freeze({ candidate_alerts: 100, shortlists: 100, talent_invites_per_month: 2000, analytics_export: true, agency_clients: 50 });
const LIVE = ['trialing', 'active', 'past_due'];

function stripeClient() {
  const cfg = plansConfig();
  if (!cfg.configured) throw featureOff('plans');
  // eslint-disable-next-line global-require
  return require('stripe')(cfg.stripeKey);
}

function appUrl(path) {
  const base = String(process.env.CLIENT_URL || process.env.APP_URL || 'https://oxsteed.com').replace(/\/+$/, '');
  return `${base}${path}`;
}

async function current(db, businessId) {
  const { rows: [sub] } = await db.query('SELECT * FROM career_employer_subscriptions WHERE business_id = $1', [businessId]);
  return sub || null;
}

/** Limits for a business. Plans off → unlimited (no behaviour change). */
async function entitlements(db, businessId) {
  if (!plansConfig().enabled) return { plan: null, plans_enabled: false, ...UNLIMITED };
  const sub = await current(db, businessId);
  const plan = sub && LIVE.includes(sub.status) ? sub.plan : 'free';
  return { plan, plans_enabled: true, ...ENTITLEMENTS[plan] };
}

async function assertWithin(db, businessId, key, used) {
  const e = await entitlements(db, businessId);
  const limit = e[key];
  if (typeof limit === 'boolean' ? !limit : used >= limit) {
    throw new AppError('Your plan does not include more of this. Upgrade to continue.', 402, 'plan_limit', { limit: key, plan: e.plan });
  }
  return e;
}

function view(sub) {
  if (!sub) return null;
  return {
    plan: sub.plan, status: sub.status, trial_ends_at: sub.trial_ends_at, current_period_end: sub.current_period_end,
    cancel_at_period_end: sub.cancel_at_period_end,
  };
}

async function status(db, businessId) {
  const cfg = plansConfig();
  return {
    enabled: cfg.enabled,
    configured: cfg.configured,
    trial_days: cfg.trialDays,
    prices: Object.fromEntries(PLANS.map((p) => [p, Boolean(cfg.priceIds[p])])),
    subscription: view(await current(db, businessId)),
    entitlements: await entitlements(db, businessId),
    catalog: ENTITLEMENTS,
  };
}

async function startCheckout(db, { access, actor, plan, referralCode = null, stripe = null }) {
  if (!access.isOwner) throw new AppError('Only the business owner can change the plan', 403, 'owner_only');
  const cfg = plansConfig();
  if (!cfg.configured) throw featureOff('plans');
  if (!PLANS.includes(plan)) throw new AppError('Validation failed', 400, 'validation_failed', { plan: 'Choose a plan' });
  const price = cfg.priceIds[plan];
  if (!price) throw new AppError('This plan is not available yet', 503, 'provider_not_configured', { reason: 'plan_not_priced' });
  const existing = await current(db, access.businessId);
  if (existing && LIVE.includes(existing.status)) throw new AppError('This business already has a plan. Use “Manage billing” to change it.', 409, 'plan_exists');
  if (referralCode) {
    try { await referrals.attribute(db, { businessId: access.businessId, actor, code: referralCode, isOwner: access.isOwner }); } catch (err) {
      if (err.code !== 'referral_exists') throw err;
    }
  }
  // One free trial per business, ever.
  const trialUsed = Boolean(existing?.trial_ends_at);
  const client = stripe || stripeClient();
  const session = await client.checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price, quantity: 1 }],
    client_reference_id: String(access.businessId),
    ...(existing?.stripe_customer_id ? { customer: existing.stripe_customer_id } : {}),
    subscription_data: {
      ...(cfg.trialDays > 0 && !trialUsed ? { trial_period_days: cfg.trialDays } : {}),
      metadata: { careers_kind: 'plan', business_id: String(access.businessId), plan },
    },
    metadata: { careers_kind: 'plan', business_id: String(access.businessId), plan },
    success_url: appUrl(`/business/${access.businessId}/careers?tab=plan&checkout=success`),
    cancel_url: appUrl(`/business/${access.businessId}/careers?tab=plan&checkout=cancelled`),
  }, { idempotencyKey: `careers-plan-${access.businessId}-${plan}-${Math.floor(Date.now() / 600000)}` });
  await db.query(
    `INSERT INTO career_employer_subscriptions (business_id, plan, status, checkout_session_id, created_by)
     VALUES ($1, $2, 'checkout_pending', $3, $4)
     ON CONFLICT (business_id) DO UPDATE SET plan = EXCLUDED.plan, checkout_session_id = EXCLUDED.checkout_session_id,
       status = CASE WHEN career_employer_subscriptions.status IN ('canceled','incomplete','checkout_pending') THEN 'checkout_pending' ELSE career_employer_subscriptions.status END,
       updated_at = NOW()`,
    [access.businessId, plan, session.id, actor.id]
  );
  return { checkout_url: session.url };
}

async function portal(db, { access, stripe = null }) {
  if (!plansConfig().configured) throw featureOff('plans');
  if (!access.isOwner) throw new AppError('Only the business owner can manage billing', 403, 'owner_only');
  const sub = await current(db, access.businessId);
  if (!sub?.stripe_customer_id) throw new AppError('No billing account yet', 404, 'not_found');
  const client = stripe || stripeClient();
  const session = await client.billingPortal.sessions.create({
    customer: sub.stripe_customer_id,
    return_url: appUrl(`/business/${access.businessId}/careers?tab=plan`),
  });
  return { portal_url: session.url };
}

function planForPrice(priceId) {
  const ids = plansConfig().priceIds;
  return PLANS.find((p) => ids[p] && ids[p] === priceId) || null;
}

const STATUS_MAP = {
  trialing: 'trialing', active: 'active', past_due: 'past_due', canceled: 'canceled', unpaid: 'unpaid',
  incomplete: 'incomplete', incomplete_expired: 'canceled', paused: 'past_due',
};

const ts = (s) => (s ? new Date(Number(s) * 1000) : null);

function isPlanEvent(event) {
  const obj = event?.data?.object || {};
  if (String(event?.type || '').startsWith('customer.subscription.')) return obj.metadata?.careers_kind === 'plan';
  if (event?.type === 'checkout.session.completed') return obj.metadata?.careers_kind === 'plan';
  if (['invoice.paid', 'invoice.payment_failed'].includes(event?.type)) {
    const meta = obj.subscription_details?.metadata || obj.parent?.subscription_details?.metadata || obj.lines?.data?.[0]?.metadata || {};
    return meta.careers_kind === 'plan';
  }
  if (event?.type === 'charge.refunded') return Boolean(obj.invoice);
  return false;
}

/** Apply one verified Stripe event (inside a transaction). */
async function applyStripeEvent(db, event) {
  const { rowCount } = await db.query(
    'INSERT INTO career_stripe_events (event_id, type) VALUES ($1, $2) ON CONFLICT DO NOTHING', [event.id, event.type]
  );
  if (!rowCount) return { duplicate: true };
  const obj = event.data?.object || {};
  if (event.type === 'checkout.session.completed') {
    const businessId = Number(obj.metadata?.business_id);
    if (!Number.isInteger(businessId)) return { ignored: true };
    await db.query(
      `UPDATE career_employer_subscriptions SET stripe_customer_id = COALESCE($2, stripe_customer_id),
              stripe_subscription_id = COALESCE($3, stripe_subscription_id), updated_at = NOW()
        WHERE business_id = $1`,
      [businessId, obj.customer || null, obj.subscription || null]
    );
    return { business_id: businessId, linked: true };
  }
  if (event.type.startsWith('customer.subscription.')) {
    const businessId = Number(obj.metadata?.business_id);
    if (!Number.isInteger(businessId)) return { ignored: true };
    const item = obj.items?.data?.[0];
    const plan = planForPrice(item?.price?.id) || obj.metadata?.plan;
    if (!PLANS.includes(plan)) return { ignored: true, reason: 'unknown_price' };
    const statusValue = event.type === 'customer.subscription.deleted' ? 'canceled' : (STATUS_MAP[obj.status] || 'incomplete');
    const periodEnd = ts(obj.current_period_end || item?.current_period_end);
    await db.query(
      `INSERT INTO career_employer_subscriptions (business_id, plan, status, stripe_customer_id, stripe_subscription_id, trial_ends_at, current_period_end, cancel_at_period_end)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (business_id) DO UPDATE SET plan = EXCLUDED.plan, status = EXCLUDED.status,
         stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, career_employer_subscriptions.stripe_customer_id),
         stripe_subscription_id = EXCLUDED.stripe_subscription_id,
         trial_ends_at = COALESCE(EXCLUDED.trial_ends_at, career_employer_subscriptions.trial_ends_at),
         current_period_end = EXCLUDED.current_period_end, cancel_at_period_end = EXCLUDED.cancel_at_period_end, updated_at = NOW()`,
      [businessId, plan, statusValue, obj.customer || null, obj.id, ts(obj.trial_end), periodEnd, Boolean(obj.cancel_at_period_end)]
    );
    return { business_id: businessId, status: statusValue, plan };
  }
  if (event.type === 'invoice.paid') {
    const subId = obj.subscription || obj.parent?.subscription_details?.subscription || null;
    const { rows: [sub] } = await db.query('SELECT business_id FROM career_employer_subscriptions WHERE stripe_subscription_id = $1', [subId]);
    if (!sub) return { ignored: true };
    const commission = await referrals.accrueFromInvoice(db, {
      businessId: sub.business_id, invoiceId: obj.id, amountPaidCents: Number(obj.amount_paid || 0), currency: obj.currency,
    });
    return { business_id: sub.business_id, commission };
  }
  if (event.type === 'invoice.payment_failed') return { ignored: true, reason: 'status_follows_subscription_event' };
  if (event.type === 'charge.refunded') {
    const voided = await referrals.voidForInvoice(db, typeof obj.invoice === 'string' ? obj.invoice : obj.invoice?.id, 'refunded');
    return { voided };
  }
  return { ignored: true };
}

module.exports = {
  ENTITLEMENTS,
  entitlements,
  assertWithin,
  status,
  startCheckout,
  portal,
  isPlanEvent,
  applyStripeEvent,
  planForPrice,
};
