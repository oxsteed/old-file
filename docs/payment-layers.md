# International payment layers

Implements `oxsteed-payment-layers-spec.md` and its LOCKED DECISIONS. Every
layer is behind a launch flag that defaults **off**; with every flag off the US
flow is unchanged (direct USD card charge, US fee schedule, English copy).

## Data model (migrations 762–764)

| Migration | Adds |
|---|---|
| 762 `payment_rails_foundation` | `job_payment_rail` enum; `currency_minor_units` (exponents); `payment_country_policies` (launch gate with `CHECK enabled ⇒ tax_review_cleared`, rail/legal flags, fees, tip cost, offline cap, FX spread ≤ 100 bps, cash-out partner/hold/caps, SMS sender, privacy regime); `jobs.payment_rail / payment_rail_locked_at / settlement_currency / location_country_code / timezone / offline_ack_at`; `users.phone_e164`; trigger anchoring date-only schedules at 09:00 job-local and mirroring decimal columns by currency exponent. Seeds US (enabled) and CA/GB/IE/HT/KE (disabled, tax review pending). |
| 763 `payment_rail_operations` | `payments.charge_model / destination_account_id / authorization_expires_at / fee_country`; `payment_fx_quotes`, `job_credit_payments`, `job_rail_switch_requests`, `job_tips` (`platform_fee_minor = 0` CHECK), `offline_payment_confirmations`, `credit_cashout_requests`; bid currency trigger (`bids_currency_matches_job`, check_violation); `job_payment_reauthorizations.charge_model`. |
| 764 `privacy_retention` | `privacy_erasure_requests`, `users.pseudonymized_at`, `job_revisions.private_stripped_at`. |

Minor units always follow the currency exponent (JPY 0, KWD 3). For non-2-decimal
currencies writers set `*_cents` / `amount_cents`; decimal columns are mirrors.

## Decisions → implementation

1. **on_behalf_of + destination** — `services/stripeChargeModel.js` (`destination`, `platform_hold`); `direct` stays for US.
2. **Express** — `createConnectAccount` uses the helper's country when `FEATURE_RAIL_STRIPE_INTL` is on.
3. **Credit hold = payment where cleared, else collateral** — `paymentRailPolicy.railOptions` (`credit_payment_legal_cleared`), `paymentRails/creditRail.js`.
4. **Helper currency is the currency of record; customer sees an estimate** — `settlement_currency`; Credit FX quotes (`payment_fx_quotes`) through the ledger conversion service. **4b** spread ≤ 1% (DB CHECK + code clamp), shown as a fee.
5. **Local methods charge now, platform holds** — `FEATURE_STRIPE_LOCAL_METHODS` + `FEATURE_PLATFORM_HOLD` + `local_methods_legal_cleared`.
6. **Switch to a less protected rail only before work starts, both consent** — `paymentRails/railSwitch.js`.
7. **Per-country fees with a Credit discount** — `computeFees` (`FEATURE_COUNTRY_FEES`).
8. **Offline requires a subscription, no per-job fee** — offline gating; no fee is charged on the offline rail.
9. **Tips carry only processing costs** — `paymentRails/tips.js`, `job_tips.platform_fee_minor = 0`.
10. **Contact details hidden before acceptance; reminders after** — `contactMaskingService` in `sendMessage`.
11. **Bids match the job currency** — DB trigger + 409 `bid_currency_mismatch`.
12. **Erasure** — `privacyRetentionService`: financial records pseudonymized and kept; EU/UK edit history kept 24 months; private fields stripped after 90 days.
13. **Helpers handle all tax; OxSteed collects none** — no Stripe Tax; country tax-review gate kept (DB CHECK + admin API).
14. **Cash-out: ID check, 7-day hold, caps, licensed partners; else spend-only** — `creditCashoutService`, `payoutPartners` (stubs).
15. **Offline: verified helper + first-job cap** — offline gating.
16. **Pilot CA/GB/IE then HT/KE** — seeded disabled; enable per country through the admin API once reviews clear.
17. **Reauthorize card holds before expiry; >5-day jobs charged now and held** — `paymentRails/holdExpiry.js` (`hold_expiring` banner), `platform_hold` for long-lead jobs.

## Flags

`FEATURE_PAYMENT_RAILS`, `FEATURE_RAIL_STRIPE_INTL`, `FEATURE_STRIPE_LOCAL_METHODS`,
`FEATURE_PLATFORM_HOLD`, `FEATURE_RAIL_CREDIT`, `FEATURE_CREDIT_CASHOUT`,
`FEATURE_RAIL_OFFLINE_GATING`, `FEATURE_COUNTRY_FEES`, `FEATURE_JOB_TIPS`,
`FEATURE_CONTACT_MASKING`, `FEATURE_HOLD_EXPIRY_REAUTH`, `FEATURE_PRIVACY_RETENTION`,
`FEATURE_LOCALIZED_NOTIFICATIONS`, `FEATURE_COUNTRY_SMS`, `FEATURE_JOB_TIMEZONES`.
Read on every call (no restart needed). `GET /api/payment-layers/config` exposes the booleans.

Tuning: `JOB_HOLD_REAUTH_LEAD_HOURS` (36), `CREDIT_AUTO_RELEASE_HOURS` (72).

## API (`/api/payment-layers`)

| Method | Path | Notes |
|---|---|---|
| GET | `/config` | flag booleans |
| GET | `/jobs/:id/options?bid_id=` | rails for a bid (customer) |
| POST | `/jobs/:id/credit-quote` | Credit FX estimate `{bid_id}` |
| GET/POST | `/jobs/:id/rail-switch` | state / request `{to_rail, offline_ack}` |
| POST | `/jobs/:id/rail-switch/:requestId/respond` | `{accept, offline_ack, fx_quote_id, credit_quote_id}` |
| GET | `/jobs/:id/offline-payment` · POST `/confirm` | `{acknowledge_not_covered: true}` |
| GET/POST | `/jobs/:id/tips` · POST `/tips/quote` | `Idempotency-Key` required to create |
| GET | `/cashout/eligibility` · GET/POST `/cashout` | `Idempotency-Key` required |
| GET/POST | `/privacy/erasure` | |
| GET | `/admin/country-policies` · PUT `/admin/country-policies/:code` | super admin; tax gate enforced |
| GET | `/admin/payout-partners` | partner status |

Acceptance: `POST /api/jobs/assign` accepts `payment_rail` (`stripe` / `credit` / `offline`), `offline_ack`, `fx_quote_id`, `credit_quote_id` when the engine is on; `payment_method` keeps working.

Money moves reject impersonated sessions and use `paymentsLimiter`.

## Workers

`jobs/paymentLayersWorker.js` (fenced job locks): every 10 min — hold-expiry flags,
Credit auto-release, rail-switch expiry, cash-out processing, erasure queue; daily —
retention sweep. Each task is a no-op while its flag is off.

## Needs legal / partner setup before enabling

- Per-country tax review (`tax_review_cleared`) — required before `enabled`.
- Legal clearance flags: `credit_payment_legal_cleared`, `local_methods_legal_cleared`, `platform_hold_legal_cleared` (holding customer funds may need an e-money / payment-institution licence or an agent-of-payee opinion per country).
- Stripe: Connect cross-border / `on_behalf_of` settlement-merchant setup per country; local method activation (e.g. M-Pesa is not a Stripe method today — needs a PSP).
- Cash-out partners (stubs, `partner_integration_pending`): Safaricom M-Pesa B2C (KE), Digicel MonCash (HT), Wise Platform (GB/IE/CA). Contracts, KYB and credentials required; adapters must implement `submitPayout` / `getPayoutStatus`.
- Twilio sender registration per country (alphanumeric sender IDs need pre-registration in KE; HT carriers vary).
- Privacy: confirm retention periods (24 months EU edit history, 90-day private-field strip) with counsel; DPA updates.

## Known limits

- Cancellation fees are not taken on the Credit rail (the hold is released in full).
- Local payment methods depend on Stripe support per country; methods Stripe lacks need a partner PSP.
