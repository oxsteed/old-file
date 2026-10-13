'use strict';

/**
 * Unit checks for the payment layers (docs/payment-layers.md): flags default
 * off, legacy parity, fees, charge models, tips, masking, templates, SMS and
 * partner stubs.
 */

const flags = require('../services/paymentLayerFlags');
const railPolicy = require('../services/paymentRailPolicy');
const chargeModel = require('../services/stripeChargeModel');
const masking = require('../services/contactMaskingService');
const templates = require('../services/notificationTemplates');
const partners = require('../services/payoutPartners');
const creditRail = require('../services/paymentRails/creditRail');
const paymentRails = require('../services/paymentRails');
const sms = require('../services/smsNotificationService');
const money = require('../validation/money');
const { calculateTier3Fees } = require('../utils/feeCalculator');

const ALL_FLAG_ENVS = Object.values(flags.FLAGS);
afterEach(() => { for (const env of ALL_FLAG_ENVS) delete process.env[env]; });

const CA = {
  country_code: 'CA', default_currency: 'CAD', platform_fee_bps: 800, platform_fee_min_minor: 300,
  credit_fee_discount_bps: 200, tip_processing_bps: 290, tip_processing_fixed_minor: 30,
};

describe('launch flags', () => {
  test('every flag defaults off', () => {
    // The shared test setup enables FEATURE_PAYMENTS_ENABLED for route
    // tests; clear it here so the default-off contract is actually tested.
    const saved = process.env.FEATURE_PAYMENTS_ENABLED;
    delete process.env.FEATURE_PAYMENTS_ENABLED;
    try {
      expect(Object.values(flags.snapshot()).every((v) => v === false)).toBe(true);
    } finally {
      if (saved !== undefined) process.env.FEATURE_PAYMENTS_ENABLED = saved;
    }
  });
  test('PLATFORM_PAYMENTS mirrors FEATURE_PAYMENTS_ENABLED for the client', () => {
    process.env.FEATURE_PAYMENTS_ENABLED = 'true';
    expect(flags.snapshot().PLATFORM_PAYMENTS).toBe(true);
    expect(flags.isEnabled('PLATFORM_PAYMENTS')).toBe(true);
    delete process.env.FEATURE_PAYMENTS_ENABLED;
    expect(flags.isEnabled('PLATFORM_PAYMENTS')).toBe(false);
    process.env.FEATURE_PAYMENTS_ENABLED = 'true';
  });
  test('flags read the environment on every call', () => {
    process.env.FEATURE_PAYMENT_RAILS = 'true';
    expect(flags.isEnabled('PAYMENT_RAILS')).toBe(true);
    process.env.FEATURE_PAYMENT_RAILS = 'off';
    expect(flags.isEnabled('PAYMENT_RAILS')).toBe(false);
  });
});

describe('rail policy with flags off (US unchanged)', () => {
  test('rail options mirror today: card + direct', async () => {
    const options = await railPolicy.railOptions({ query: jest.fn() }, { job: { currency_code: 'USD' }, amountMinor: 10000 });
    expect(options.engine).toBe(false);
    expect(options.rails.map((r) => [r.rail, r.available, r.charge_model])).toEqual([['stripe', true, 'direct'], ['offline', true, null]]);
  });
  test('fees delegate to the existing calculator', () => {
    const legacy = calculateTier3Fees(12345);
    const fees = railPolicy.computeFees({ amountMinor: 12345, currency: 'USD', policy: CA });
    expect(fees.platform_fee_minor).toBe(legacy.platform_fee_cents);
    expect(fees.application_fee_minor).toBe(legacy.application_fee_cents);
  });
  test('acceptance body keeps payment_method when the engine is off', () => {
    expect(paymentRails.paymentMethodForRequest({ payment_method: 'off_platform', payment_rail: 'credit' })).toEqual({ rail: null, paymentMethod: 'off_platform' });
  });
});

describe('country fees (decision #7)', () => {
  beforeEach(() => { process.env.FEATURE_COUNTRY_FEES = 'true'; });
  test('basis points with a local minimum', () => {
    expect(railPolicy.computeFees({ amountMinor: 10000, currency: 'CAD', policy: CA }).platform_fee_minor).toBe(800);
    expect(railPolicy.computeFees({ amountMinor: 1000, currency: 'CAD', policy: CA }).platform_fee_minor).toBe(300);
  });
  test('Credit gets the discount', () => {
    const fees = railPolicy.computeFees({ amountMinor: 10000, currency: 'CAD', policy: CA, rail: 'credit' });
    expect(fees).toMatchObject({ platform_fee_minor: 600, credit_discount_bps: 200 });
  });
  test('the fee never exceeds the amount', () => {
    expect(railPolicy.computeFees({ amountMinor: 100, currency: 'CAD', policy: CA }).platform_fee_minor).toBe(100);
  });
});

describe('tips carry only processing cost (decision #9)', () => {
  test('card tip pays the processing cost only', () => {
    expect(railPolicy.tipProcessingCost({ amountMinor: 1000, rail: 'stripe', policy: CA })).toBe(29 + 30);
  });
  test('Credit tips are free', () => {
    expect(railPolicy.tipProcessingCost({ amountMinor: 1000, rail: 'credit', policy: CA })).toBe(0);
  });
});

describe('rail switching helpers (decision #6) and long-lead jobs (#17)', () => {
  test('downgrades are detected by protection level', () => {
    expect(railPolicy.isDowngrade('stripe', 'offline')).toBe(true);
    expect(railPolicy.isDowngrade('offline', 'stripe')).toBe(false);
  });
  test('jobs more than 5 days out are long-lead', () => {
    const now = Date.parse('2030-01-01T00:00:00Z');
    expect(railPolicy.longLeadJob({ scheduled_start_at: '2030-01-07T00:00:00Z' }, now)).toBe(true);
    expect(railPolicy.longLeadJob({ scheduled_start_at: '2030-01-05T00:00:00Z' }, now)).toBe(false);
    expect(railPolicy.longLeadJob({}, now)).toBe(false);
  });
  test('unavailable rails raise their reason', () => {
    expect(() => railPolicy.assertRailAvailable({ rails: [{ rail: 'credit', available: false, reason: 'credit_rail_not_enabled' }] }, 'credit'))
      .toThrow(expect.objectContaining({ code: 'credit_rail_not_enabled' }));
  });
});

describe('Stripe charge models (decisions #1 #2 #5)', () => {
  const base = { amountMinor: 5000, currency: 'CAD', applicationFeeMinor: 400, helperAccountId: 'acct_h', metadata: { job_id: 'j1' } };
  test('direct charges run on the connected account (today)', () => {
    const { params, options } = chargeModel.intentParams({ ...base, model: 'direct', currency: 'USD' });
    expect(options).toEqual({ stripeAccount: 'acct_h' });
    expect(params).toMatchObject({ currency: 'usd', capture_method: 'manual', application_fee_amount: 400 });
    expect(params.on_behalf_of).toBeUndefined();
  });
  test('destination charges use on_behalf_of + transfer_data', () => {
    const { params, options } = chargeModel.intentParams({ ...base, model: 'destination' });
    expect(options).toEqual({});
    expect(params).toMatchObject({ currency: 'cad', capture_method: 'manual', on_behalf_of: 'acct_h', transfer_data: { destination: 'acct_h' }, application_fee_amount: 400 });
  });
  test('platform hold charges now and keeps funds on the platform', () => {
    const { params } = chargeModel.intentParams({ ...base, model: 'platform_hold' });
    expect(params).toMatchObject({ capture_method: 'automatic', on_behalf_of: 'acct_h', transfer_group: 'job_j1' });
    expect(params.transfer_data).toBeUndefined();
    expect(params.application_fee_amount).toBeUndefined();
  });
  test('funded amount per model', () => {
    expect(chargeModel.fundedAmount({ status: 'succeeded', amount_received: 5000 }, 'platform_hold')).toBe(5000);
    expect(chargeModel.isFunded({ status: 'requires_capture' }, 'destination')).toBe(true);
    expect(chargeModel.requestOptions({ charge_model: 'destination', stripe_account_id: 'acct_h' })).toEqual({});
  });
  test('releasing a platform hold refunds; an authorization is canceled', async () => {
    const stripe = { refunds: { create: jest.fn().mockResolvedValue({}) }, paymentIntents: { cancel: jest.fn().mockResolvedValue({}) } };
    await chargeModel.releaseIntent(stripe, { intentId: 'pi_1', model: 'platform_hold', idempotencyKey: 'k' });
    expect(stripe.refunds.create).toHaveBeenCalledWith(expect.objectContaining({ payment_intent: 'pi_1' }), { idempotencyKey: 'k' });
    await chargeModel.releaseIntent(stripe, { intentId: 'pi_2', model: 'direct', stripeAccount: 'acct_h', idempotencyKey: 'k2' });
    expect(stripe.paymentIntents.cancel).toHaveBeenCalled();
  });
});

describe('Credit FX math (decisions #4 #4b)', () => {
  test('the source amount always covers the target across exponents', () => {
    // 1 USD = 150 JPY: 1500 JPY needs 1000 US cents.
    expect(creditRail.sourceForTarget(1500, 'USD', 'JPY', '150', '1')).toBe(1000);
    const src = creditRail.sourceForTarget(12345, 'USD', 'CAD', '137', '100');
    expect(money.convertMinor(src, 'USD', 'CAD', '137', '100')).toBeGreaterThanOrEqual(12345);
  });
  test('rates are rescaled for minor units', () => {
    expect(creditRail.minorRate('USD', 'JPY', '150', '1')).toEqual({ num: '150', den: '100' });
    expect(creditRail.minorRate('USD', 'KWD', '3', '10')).toEqual({ num: '30', den: '10' });
  });
});

describe('contact masking (decision #10)', () => {
  test('emails, links and handles are masked', () => {
    const out = masking.maskContactDetails('mail me a@b.co or wa.me/123 or @painter_joe');
    expect(out).not.toMatch(/a@b\.co|wa\.me|painter_joe/);
    expect(masking.hasContactDetails('see www.example.com')).toBe(true);
    expect(masking.hasContactDetails('see you at 9')).toBe(false);
  });
  test('off by default: no masking, no reminder', async () => {
    await expect(masking.evaluate({ query: jest.fn() }, { customer_id: 'c', helper_id: 'h', job_id: 'j' })).resolves.toEqual({ mask: false, remind: false });
  });
  test('before a hire it masks; after a hire it reminds', async () => {
    process.env.FEATURE_CONTACT_MASKING = 'true';
    const pre = { query: jest.fn().mockResolvedValue({ rows: [{ status: 'published', assigned_helper_id: null }] }) };
    await expect(masking.evaluate(pre, { customer_id: 'c', helper_id: 'h', job_id: 'j' })).resolves.toEqual({ mask: true, remind: false });
    const hired = { query: jest.fn().mockResolvedValue({ rows: [{ status: 'accepted', assigned_helper_id: 'h' }] }) };
    await expect(masking.evaluate(hired, { customer_id: 'c', helper_id: 'h', job_id: 'j' })).resolves.toEqual({ mask: false, remind: true });
  });
});

describe('localized notifications', () => {
  test('English is used while the flag is off', () => {
    expect(templates.render('payment_hold_expiring', { preferred_language: 'fr' }).title).toBe('Renew your payment hold');
  });
  test('each template exists in all five languages', () => {
    for (const [key, byLang] of Object.entries(templates.TEMPLATES)) {
      for (const lang of templates.LANGS) expect(byLang[lang]).toBeTruthy();
      expect(Object.keys(byLang).sort()).toEqual([...templates.LANGS].sort());
      expect(key).toBeTruthy();
    }
  });
  test('the recipient language is used when the flag is on', () => {
    process.env.FEATURE_LOCALIZED_NOTIFICATIONS = 'true';
    expect(templates.render('payment_hold_expiring', { preferred_language: 'es' }).title).toBe('Renueva la retención del pago');
  });
});

describe('cash-out partners (decision #14)', () => {
  test('stub partners never count as configured and refuse to move money', async () => {
    const list = partners.listPartners();
    expect(list.map((p) => p.name).sort()).toEqual(['moncash', 'mpesa_b2c', 'wise_payouts']);
    expect(list.every((p) => p.configured === false && p.integrated === false && p.requiredEnv.length > 0)).toBe(true);
    await expect(partners.getPartner('mpesa_b2c').submitPayout({})).rejects.toMatchObject({ code: 'partner_integration_pending' });
  });
  test('a real adapter can be registered against the interface', () => {
    const fake = { name: 'test_partner', countries: ['GB'], isConfigured: () => true, submitPayout: jest.fn(), getPayoutStatus: jest.fn() };
    partners.registerPartner(fake);
    expect(partners.getPartner('test_partner')).toBe(fake);
    partners.unregisterPartner('test_partner');
    expect(() => partners.registerPartner({ name: 'broken' })).toThrow(/missing/);
  });
});

describe('country-aware SMS', () => {
  test('numbers are normalised to E.164', () => {
    expect(sms.toE164('3612-3456', 'HT')).toBe('+50936123456');
    expect(sms.toE164('0712 345 678', 'KE')).toBe('+254712345678');
    expect(sms.toE164('(555) 123-4567')).toBe('+15551234567');
    expect(sms.toE164('+44 7700 900123')).toBe('+447700900123');
    expect(sms.toE164('')).toBeNull();
  });
  test('the sender is per country only when the flag is on', () => {
    process.env.TWILIO_FROM_KE = 'OxSteedKE';
    expect(sms.senderFor('+254712345678').from).not.toBe('OxSteedKE');
    process.env.FEATURE_COUNTRY_SMS = 'true';
    expect(sms.senderFor('+254712345678')).toEqual({ from: 'OxSteedKE' });
    delete process.env.TWILIO_FROM_KE;
  });
});
