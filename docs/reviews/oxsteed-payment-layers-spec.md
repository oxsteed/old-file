# OxSteed International Multi-Layer Payment Model: Spec

Status: **Draft for decision.** No code has been changed.
Basis: repo `oxsteed/old-file`, PR #492 branch `fix/job-edit-scale` @ `cb1d53ba`, and the international viability audit of 2026-10-12.
Citation marks: **[V]** = verified at the cited line. **[I]** = inferred, not traced end to end.
This is not legal advice. Every licensing or compliance item is flagged **LEGAL REVIEW**.

---

## 0. Summary

Each job is paid on exactly one **payment rail**, chosen in this order of preference:

1. **`stripe`**: card or local payment methods, with platform escrow (manual capture). Used wherever Stripe Connect can onboard the helper *and* charge the customer.
2. **`credit`**: OxSteed Credit escrow. Used where Stripe can charge the customer but cannot pay out to the helper. The customer buys Credit through Stripe, the Credit is held in escrow, the helper spends it inside OxSteed (closed loop), and cash-out goes through gated local payout partners.
3. **`offline`**: the customer pays the helper directly in cash or mobile money (M-Pesa, MonCash, and others). OxSteed holds no escrow and offers no refunds. OxSteed charges its fee through prepaid Credit or a listing fee / subscription. The UI labels these jobs plainly as **not covered**, and stronger trust signals apply.

The rail is fixed when the bid is accepted. It drives the hold, completion, disputes, change orders, reauthorization, tips, refunds and cancellations.

---

## 1. Current state (grounding)

### Payment model
| Area | Current state | Ref |
|---|---|---|
| Accept-time payment choice | `payment_method` must be `'oxsteed'` or `'off_platform'` | `server/controllers/jobController.js:728`, `:744` [V] |
| Platform payments flag | `FEATURE_PAYMENTS_ENABLED`, default off | `jobController.js:38-40`, `:750` [V] |
| Escrow tier | `jobs.transaction_mode = 'guided_protected'` marks Stripe escrow | `jobController.js:34-35`; set in `paymentController.js` `createPaymentIntent` [V] |
| Credit collateral | on `'oxsteed'` accept, a Credit hold for the bid amount (USD) | `jobController.js` (assign, `spendWithCredit` with `currency: 'USD'`) ~`:1049` [V] |

### Stripe
| Area | Current state | Ref |
|---|---|---|
| Connect account country | hard-coded `country: 'US'`, Express | `server/controllers/paymentController.js:167-169` [V] |
| Charge currency | `currency: 'usd'` everywhere | `paymentController.js:380`, `:504`, `:522`; `services/jobPaymentReauthorizationService.js:267` [V] |
| Charge model | direct charge on the connected account, `payment_method_types: ['card']`, `capture_method: 'manual'` | `paymentController.js:378-395` [V] |
| Fees | 7.1% with a $5 minimum (USD cents) | `server/utils/feeCalculator.js:33-34` [V] |
| Maximum payment | $50,000 | `paymentController.js:284` [V] |

### Money and currency
| Area | Current state | Ref |
|---|---|---|
| Amount units | cents assumed (×/÷100) | `client/src/utils/jobEditModel.js:38`, `:44`, `:52`; `jobController.js:136` [V] |
| Job currency | `jobs.currency_code` stored (default USD) but never used for charges | `jobController.js:138`; migration `352` [V] |

### Change orders and reauthorization (PR #492)
| Area | Current state | Ref |
|---|---|---|
| Re-pricing finance | `services/jobChangeOrderFinance.js`; reauthorization in `services/jobPaymentReauthorizationService.js`; migration `761` | [V] |
| Credit holds on change orders | replaced at the new price; insufficient Credit sets `creditAdjustmentRequired` | `jobChangeOrderFinance.js` (`replaceCreditCollateral`) [V] |

### OxSteed Credit services
| Service | Role | Ref |
|---|---|---|
| Spend adapter | modes `hold` / `immediate`; surfaces include `jobs` | `services/creditSpendAdapter.js:159-260`, `:425` [V] |
| Top-up | Stripe-funded buy-in | `services/oxsteedCreditTopupService.js` [V] |
| Withdrawal | uses `stripe.transfers` | `services/oxsteedCreditWithdrawalService.js:371` [V] |
| Currency conversion | minor-unit amounts, `roundHalfUp` | `services/oxsteedCreditCurrencyConversionService.js:58`, `:127-131` [V] |
| Accounts and holds | carry `currency_code` / `settlement_currency_code` (default USD) | `migrations/421_oxsteed_credit_foundation.sql:14-15`, `:86` [V] |
| Fee schedule | fees per operation × currency | `services/oxsteedCreditFeeScheduleService.js:50`, `:88` [V] |
| Supporting services | partner ledger, sub-bank, reserve, settlement calendar | `services/oxsteedCredit*` [I: capabilities summarized, not exercised] |

### Disputes, notifications, trust, search, retention
| Area | Current state | Ref |
|---|---|---|
| Disputes | `controllers/disputeController.js:57` (`openDispute`); completion/capture blocked while a dispute is open | `jobController.js` completeJob [V] |
| Notifications | server outbox text is English only | `server/jobs/jobEventOutbox.js` [V] |
| SMS | Twilio with a `+1` placeholder sender | `services/smsNotificationService.js:12` [V] |
| Verification | Didit (`didit_status`) used by bid gating | [I] |
| Search | `'simple'` text search config (language-neutral) | `migrations/760_job_edit_scale_foundation.sql:178-180` [V] |
| Retention | `job_revisions` kept 36 months by default (minimum 12) | `server/jobs/jobRevisionMaintenance.js` [V] |
| Erasure | no erasure path covering job revisions, the outbox or reauthorization rows | [I: none found by search] |

---

## 2. Data model

### 2.1 `jobs.payment_rail`

New enum:
```sql
CREATE TYPE job_payment_rail AS ENUM ('stripe', 'credit', 'offline');
ALTER TABLE jobs
  ADD COLUMN payment_rail job_payment_rail,             -- NULL until a bid is accepted
  ADD COLUMN payment_rail_locked_at TIMESTAMPTZ,
  ADD COLUMN settlement_currency CHAR(3),                -- currency of escrow/settlement
  ADD COLUMN customer_country CHAR(2), ADD COLUMN helper_country CHAR(2);
```

Backfill from the existing fields:

| Existing state | New `payment_rail` |
|---|---|
| `transaction_mode = 'guided_protected'` | `stripe` |
| accepted with `payment_method = 'oxsteed'`, no Stripe payment | `credit` (collateral only today; **see Decision 3**) |
| `'off_platform'` | `offline` |

`transaction_mode` stays as a derived mirror for one release, then is removed.

The bid also carries the rail the helper accepts (`bids.payment_rails_accepted job_payment_rail[]`). `payment_method` on `/jobs/assign` maps onto `payment_rail` (`oxsteed` → `stripe` or `credit` by eligibility; `off_platform` → `offline`).

### 2.2 Money as currency plus minor units

- All new money columns are `*_minor BIGINT` plus `currency CHAR(3)`.
- The existing `*_cents` columns keep USD meaning only. A trigger mirrors them while `currency = 'USD'` during migration.
- One shared module, `server/utils/money.js`, with a client copy and a parity test like `jobSchema`, provides:
  - `minorUnitExponent(currency)`: 0 for JPY/KRW/VND/CLP/UGX…, 3 for KWD/BHD/OMR/JOD/TND, 2 otherwise. Stripe special cases, such as HUF/TWD/ISK payout rules, live in a config table (**Decision 4**).
  - `toMinor(decimalString, currency)` and `fromMinor(minor, currency)` (string-based, no floats).
  - `format(minor, currency, locale)` via `Intl.NumberFormat`.
- Limits become per currency in `currency_limits(currency, min_charge_minor, max_charge_minor, fee_min_minor)`. This replaces the hard-coded `$50,000` (`paymentController.js:284`) and the `$5` minimum (`feeCalculator.js:34`).

### 2.3 Rail eligibility config

```sql
CREATE TABLE payment_rail_country_policy (
  country CHAR(2) PRIMARY KEY,
  stripe_charge BOOLEAN NOT NULL DEFAULT FALSE,     -- customers here can pay via Stripe
  stripe_payout BOOLEAN NOT NULL DEFAULT FALSE,     -- helpers here can onboard to Connect
  credit_buy BOOLEAN NOT NULL DEFAULT FALSE,
  credit_cashout_partner TEXT,                      -- NULL = closed-loop only
  offline_allowed BOOLEAN NOT NULL DEFAULT FALSE,
  offline_methods TEXT[] NOT NULL DEFAULT '{}',     -- 'cash','mpesa','moncash',...
  default_currency CHAR(3) NOT NULL,
  local_payment_methods TEXT[] NOT NULL DEFAULT '{}',-- Stripe PM types to offer
  tax_mode TEXT NOT NULL DEFAULT 'none',            -- 'stripe_tax'|'manual'|'none'
  enabled BOOLEAN NOT NULL DEFAULT FALSE,           -- launch gate
  notes TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

- Admin-editable, audit-logged, and cached.
- A helper's country comes from the Connect account country or the verified Didit country. A customer's country comes from the billing country, falling back to the profile.

---

## 3. Rail selection

### 3.1 Eligibility (evaluated at bid acceptance)

```
stripe  ⇐ policy[customer].stripe_charge ∧ policy[helper].stripe_payout ∧ helper.connect.charges_enabled
          ∧ currency supported for both ∧ FEATURE_RAIL_STRIPE
credit  ⇐ policy[customer].credit_buy ∧ helper has a Credit participant ∧ FEATURE_RAIL_CREDIT
          ∧ (customer balance ≥ price  OR  can top up now via Stripe)
offline ⇐ policy[customer].offline_allowed ∧ policy[helper].offline_allowed ∧ helper opted in
          ∧ customer and helper meet the offline trust bar (§9) ∧ FEATURE_RAIL_OFFLINE
```

### 3.2 Default and switching

- **Default:** the first eligible rail in the order stripe → credit → offline. The customer may pick a *lower* rail only if the helper accepts it. Going down shows an explicit "you lose protection" confirmation.
- **Before acceptance:** the rail is a preference only. Bids show which rails the helper accepts.
- **At acceptance:** the rail is locked (`payment_rail_locked_at`).
- **After lock**, switching is allowed only:
  - **Up** (offline → credit/stripe, or credit → stripe): needs both parties' consent and a fresh hold.
  - **Down** (stripe/credit → offline): needs both parties' consent, releases the hold, and is not available once work has started (`in_progress`). **Decision 6.**
  - Every switch writes `job_revisions` (source `rail_switch`) and an outbox event.

---

## 4. Lifecycle behavior by rail

| Event | `stripe` | `credit` | `offline` |
|---|---|---|---|
| **Hold at acceptance** | Manual-capture PaymentIntent in `settlement_currency` (local payment methods where capture-later is supported; otherwise pay now into the platform balance, see Decision 5). | `spendWithCredit(mode:'hold')` for the full price in the customer's Credit currency. Top up via Stripe first if short (`oxsteedCreditTopupService`). | None. Optional upfront fee from Credit or a listing fee (§5). |
| **Completion** | Capture (`captureAuthorizedPaymentWithClient`). Blocked by an open dispute or a pending reauthorization (PR #492). | Finalize the hold to the helper's Credit (`finalizeCreditSpend`). The platform fee goes to OxSteed's ledger. | Both parties confirm "paid and completed" (customer confirms payment sent; helper confirms received). Reviews unlock. |
| **Disputes** | Existing flow; funds stay held. Partial capture or refund on resolution. | Hold frozen. Resolution splits the hold (release part to the customer, finalize the rest). | No funds. Mediation only: account sanctions, review flags, ban list. The "not covered" label applies. |
| **Change order +** | Reauthorization (PR #492, `reauthorization_required`). | Replace the hold at the new price. If short, top up or set `creditAdjustmentRequired` (PR #492). | The price changes and both confirm. Fee delta billed per §5. |
| **Change order −** | Lower the capture ceiling (`capture_amount_cents`). | Replace the hold at the lower price. | The price changes. |
| **Auth expiry** | Track `authorization_expires_at` per PaymentIntent (method- and region-specific). Reauthorize ~24h ahead (new job, extends PR #492). | N/A (holds do not expire; optional TTL). | N/A |
| **Tips** | Separate PaymentIntent after completion (immediate capture), 0% platform fee (Decision 9). | Immediate Credit transfer customer → helper. | Off-platform; the UI only records "tip given" (optional). |
| **Refunds** | Stripe refund (existing `paymentRefundService`). | Credit refund to the customer's balance. Card cash-back only through top-up refund rules. | None. The UI says so before acceptance and on the job. |
| **Cancellation** | Existing fee rules (`jobCancellationService`). Release or partially capture. | Release the hold; the cancellation fee is finalized from the hold. | No funds. A cancellation reason feeds trust scores. Listing fee not refunded (Decision 8). |
| **Payout to helper** | Stripe Connect payout in the helper's currency (cross-border via destination charges + `on_behalf_of`, Decision 1). | Helper Credit balance: spend in-app, or cash out via a partner (§6) after holding periods and KYC. | Direct between the parties. |

All branches key off `jobs.payment_rail`. The code path is a `railStrategy(job)` dispatcher with one module per rail (`services/rails/{stripe,credit,offline}.js`), each implementing these operations:

```
hold
captureOrFinalize
release
adjust(delta)
refund
tip
cancel
assertCompletable
```

`assertNoPendingAdjustment` (PR #492) becomes `rail.assertCompletable(job)`.

---

## 5. Fee collection and anti-leakage

### 5.1 Fees per rail

| Rail | How the fee is collected | Rate |
|---|---|---|
| stripe | `application_fee_amount` (direct charge) or `transfer_data` withholding (destination). Computed in minor units of the settlement currency. | Configurable per country/currency (`fee_schedule`), default 7.1% with a per-currency minimum. |
| credit | Kept at `finalizeCreditSpend`. Ledger entry to the OxSteed fee account. Reuse `oxsteedCreditFeeScheduleService.quoteFee`. | Same as stripe, or lower to encourage the rail (Decision 7). |
| offline | One of these options (**Decision 8**): **(a)** upfront Credit fee at acceptance (helper or customer pays a % of the agreed price from Credit); **(b)** a flat listing fee per job; **(c)** a helper subscription with unlimited offline jobs. | Recommended: (a) for the helper, with a lower % plus a monthly cap. |

### 5.2 Anti-leakage

- Contact details stay hidden until acceptance (existing behavior).
- Message scanning nudges toward the platform (no blocking); see Decision 10.
- Protection benefits exist only on stripe/credit: dispute coverage, refunds, review weight, and search boost for protected completions.
- The offline fee is charged at *acceptance*, not completion, so it can't be dodged by never marking the job complete.
- Repeat pairs that keep going offline after one protected job are flagged as metrics only. No automatic penalty.

---

## 6. OxSteed Credit layer (rail 2)

### Buy-in
- Stripe top-up in the customer's currency (`oxsteedCreditTopupService`).
- The Credit account is denominated in that currency, or in the account's settlement currency (`421:14-15`).

### Escrow
- Holds via `spendWithCredit(surface:'jobs', mode:'hold')` (`creditSpendAdapter.js:159+`).
- Collateral-only holds today (`jobCreditCollateral.js` releases the hold at completion) become **payment holds** that are finalized to the helper. This is the key behavior change; see Decision 3.

### Closed-loop spend
- Helpers spend Credit on OxSteed surfaces (food, marketplace, subscriptions, offline-job fees, boosts).

### Cross-currency
- Uses `oxsteedCreditCurrencyConversionService` (minor units, `roundHalfUp` at `:58`).
- **OxSteed owns the FX**: the rate is quoted at hold time and stored on the hold (`fx_rate`, `fx_source`, `fx_quoted_at`), with a spread from `fee_schedule`.
- Hold and finalize both use the hold-time rate, so a job never re-converts.

### Cash-out
- Gated. Allowed only for KYC-verified helpers (Didit level ≥ X), after a holding period (e.g. 7 days after completion), within per-country limits.
- Goes through a payout partner per country (`credit_cashout_partner`, e.g. mobile-money disbursement APIs).
- Stripe `transfers` (`oxsteedCreditWithdrawalService.js:371`) only where the helper has Connect.
- Partner payouts are an adapter interface: `quote`, `create`, `status`, and a webhook.
- Reconciled through the existing partner ledger and the external reconciliation services.

### Licensing risk (LEGAL REVIEW)
Storing value, transferring it between users and cashing it out may count as e-money issuance, money transmission (MSB/MTL in the US, EMI in the EU/UK) or payment-service activity, depending on the country. Mitigations to evaluate with counsel:
- Closed loop only in some countries.
- A licensed partner holds the funds (sponsor or agent model).
- Caps, expiry rules, and safeguarding accounts.

Launch per country only after sign-off.

---

## 7. Offline layer (rail 3)

### Methods
- Cash, M-Pesa, MonCash, Airtel Money, MTN MoMo, bank transfer, chosen from `offline_methods`.
- OxSteed never touches the funds. It records the method and the reference the customer enters (optional).

### Not covered
- A persistent badge on the job, bid acceptance, the agreement and receipts.
- Acceptance needs an explicit checkbox ("I understand OxSteed can't refund or hold this payment").

### Trust bar for offline
- Didit-verified identity for the helper. Customer verification depends on the country policy.
- Minimum review count / rating, or a first-job value cap.
- Completion reconfirmation (both parties) plus an optional photo or receipt.
- Fast report/ban flow, plus a shared fraud list (`fraudCaseService`).

### Disputes
- Mediation and account actions only. No funds.

---

## 8. Currency, FX and rounding

- **Settlement currency** per job = the helper's payout currency on stripe, the hold currency on credit, and the agreed currency on offline.
- **Display:** amounts show in the customer's currency, with the settlement amount shown if it differs.
- **Ownership:**
  - On the stripe rail, Stripe's FX applies when presentment ≠ settlement. OxSteed does not mark that up (Decision 4b).
  - On the credit rail, OxSteed sets the rate (quoted and stored) from a rate provider plus a spread.
- **Rounding:**
  - Fees are calculated in minor units, rounding half up per line item (consistent with `roundHalfUp`).
  - The helper's net = gross − fee, so rounding never makes them disagree.
  - Zero-decimal currencies never produce sub-unit amounts.
  - Stripe special cases (e.g. HUF/TWD amounts must be divisible by 100 for some payouts) are enforced from the currency config.
- **Bid amounts** are stored in the job's currency (`bids.amount_minor`, `bids.currency`). A bid in a different currency than the job is rejected (Decision 11).

---

## 9. Tax

- **stripe rail:**
  - Stripe Tax on the **platform fee** (OxSteed's supply) where `tax_mode = 'stripe_tax'`.
  - Helpers are responsible for their own service tax by default. Optional OSS/marketplace-facilitator handling per country is LEGAL REVIEW.
  - Store the customer and helper tax IDs (VAT ID, GSTIN, ABN) in a new `tax_profiles` table.
- **credit rail:** VAT/GST on the fee is calculated at finalize, using Stripe Tax's calculation API (no charge) or manual rates.
- **offline rail:** tax on the offline fee / listing fee / subscription only, invoiced via Stripe Billing + Tax.
- **Invoices:** per-jurisdiction fee invoices/receipts (sequential numbering where required).

---

## 10. Privacy, GDPR, retention

### Erasure job (new)
On account deletion, anonymize:
- `job_revisions.changes` for private fields (`private_notes`, `location_*`; `PRIVATE_REVISION_FIELDS` in `services/jobEditService.js:35`), plus `actor_id` and `reason`.
- `job_event_outbox.payload`.
- `job_payment_reauthorizations.requested_by` and `failure_message`.
- Offline payment references.

Financial records are kept in pseudonymized form for statutory periods (Decision 12).

### Retention
- `JOB_REVISION_RETENTION_MONTHS` per region (minimum 12; EU default 24).
- Private fields stripped from revisions after N days, independent of partition drop.

### Other privacy items
- **Data residency:** out of scope for phase 1. Document the processors (Stripe, Didit, Twilio, payout partners) and SCCs.
- **Exports:** add payment rail, holds and Credit ledger to the existing data export.
- **Credit KYC data** is minimized and stored with the partner where possible.

---

## 11. Notifications and UI copy

- Server notifications move from English text (`jobEventOutbox.js`) to **template keys plus params**, localized by the recipient's `preferred_language` at send time.
- SMS via country-aware senders (Twilio Messaging Services / alpha sender IDs; registrations per country are a LEGAL/OPS item). Phone numbers stored in E.164 and validated with libphonenumber.
- **All new strings must ship in en, es, fr, ht and ar (RTL)**, in both catalogs (`client/src/locales/*.json`, `client/src/i18n/locales/*/common.json`), with parity tests (pattern: `client/scripts/paymentReauth.test.mjs`).

Core copy (keys under `paymentRail.*`):

| key | en | es | fr | ht | ar |
|---|---|---|---|---|---|
| `stripe.label` | Protected payment | Pago protegido | Paiement protégé | Peman pwoteje | دفع محمي |
| `credit.label` | Paid with OxSteed Credit (protected) | Pagado con Crédito OxSteed (protegido) | Payé en Crédit OxSteed (protégé) | Peye ak Kredi OxSteed (pwoteje) | مدفوع برصيد OxSteed (محمي) |
| `offline.label` | Paid directly: not covered by OxSteed | Pago directo: sin cobertura de OxSteed | Paiement direct : non couvert par OxSteed | Peye dirèkteman: OxSteed pa kouvri l | دفع مباشر: غير مشمول بحماية OxSteed |
| `offline.ack` | I understand OxSteed can’t hold, refund, or recover this payment. | Entiendo que OxSteed no puede retener, reembolsar ni recuperar este pago. | Je comprends qu’OxSteed ne peut ni retenir, ni rembourser, ni récupérer ce paiement. | Mwen konprann OxSteed pa ka kenbe, ranbouse, ni rekipere peman sa a. | أفهم أن OxSteed لا يمكنها حجز هذا المبلغ أو استرداده أو استعادته. |
| `downgrade.warning` | Switching to direct payment removes payment protection. | Cambiar a pago directo elimina la protección del pago. | Passer au paiement direct supprime la protection du paiement. | Si w pase nan peman dirèk, w ap pèdi pwoteksyon peman an. | التحويل إلى الدفع المباشر يلغي حماية الدفع. |
| `offline.confirmPaid` | Confirm you paid {{amount}} by {{method}} | Confirma que pagaste {{amount}} con {{method}} | Confirmez avoir payé {{amount}} par {{method}} | Konfime ou peye {{amount}} ak {{method}} | أكّد أنك دفعت {{amount}} عبر {{method}} |
| `fee.offlineUpfront` | OxSteed fee {{amount}} is charged from your Credit when you accept. | La comisión de OxSteed de {{amount}} se cobra de tu crédito al aceptar. | Les frais OxSteed de {{amount}} sont prélevés sur votre crédit à l’acceptation. | Frè OxSteed {{amount}} ap retire nan kredi ou lè ou aksepte. | تُخصم رسوم OxSteed البالغة {{amount}} من رصيدك عند القبول. |

All translations need native review before launch.

---

## 12. Launch flags

| Flag | Default | Gates |
|---|---|---|
| `FEATURE_PAYMENTS_ENABLED` (existing) | off | all platform payments |
| `FEATURE_RAIL_STRIPE_INTL` | off | non-US Connect onboarding and non-USD charges |
| `FEATURE_STRIPE_LOCAL_METHODS` | off | non-card Stripe payment methods |
| `FEATURE_STRIPE_TAX` | off | tax calculation on fees |
| `FEATURE_RAIL_CREDIT` | off | credit rail for jobs (payment holds, not collateral) |
| `FEATURE_CREDIT_CASHOUT_PARTNERS` | off | partner payouts |
| `FEATURE_RAIL_OFFLINE` | off | offline rail + offline fee |
| `payment_rail_country_policy.enabled` | false per country | country-level launch |

---

## 13. Migration plan and phased rollout

| Phase | Scope | Exit criteria |
|---|---|---|
| **0: Foundations** (no behavior change) | `money.js` + minor units + currency config; `payment_rail` column + backfill; `railStrategy` dispatcher wrapping today's behavior; country policy table (US only enabled); localized notification templates; erasure job. | All existing tests green; parity tests; zero diff in US flows. |
| **1: Stripe international** | Connect country from user; destination charges + `on_behalf_of` (Decision 1); per-currency fees/limits; auth-expiry tracking + proactive reauthorization; Stripe Tax on fees; 2–3 pilot countries (e.g. CA, GB, IE). | Pilot GMV, auth failure < X%, no rounding incidents. |
| **2: Local methods** | SEPA/iDEAL/Bancontact/etc. where they support manual capture or a platform-balance hold model. | Conversion uplift in pilot countries. |
| **3: Credit rail** | Payment holds (not collateral), FX quotes stored on holds, closed loop; then partner cash-out per country after LEGAL REVIEW. | Ledger reconciliation clean for 30 days; legal sign-off per country. |
| **4: Offline rail** | Offline methods, upfront fee, trust bar, "not covered" UX in target countries (e.g. HT, KE). | Fee collection rate, dispute/report rate under thresholds. |

### Migrations (numbering continues after 761)
- **762**: rail enum + jobs columns + backfill.
- **763**: currency config + limits.
- **764**: country policy.
- **765**: `bids.amount_minor`/`currency` + money mirrors.
- **766**: tax profiles.
- **767**: Credit hold FX fields + payment-hold mode.
- **768**: offline payment records + fees.
- **769**: erasure bookkeeping.

All migrations are additive and idempotent. Mirrors last one release before old columns are dropped.

---

## 14. Risks

1. **Licensing:** Credit cash-out and stored value (e-money/MSB/EMI). LEGAL REVIEW; possibly closed-loop-only by country.
2. **Rounding/FX errors:** fees and holds disagree with Stripe in zero- or 3-decimal currencies. Mitigate with a shared money module, property tests and a Stripe test-mode matrix.
3. **Auth expiry:** on long jobs and regional short windows. Mitigate with proactive reauthorization and an escrow-to-platform-balance alternative.
4. **Cross-border Connect limits:** Stripe may not support a given country pair. The policy table blocks unsupported pairs.
5. **Offline fraud and leakage:** no recourse. Mitigate with the trust bar, upfront fees, caps and bans.
6. **Tax misclassification:** marketplace-facilitator rules. LEGAL/TAX REVIEW.
7. **Notification deliverability:** SMS sender registration per country.
8. **Complexity:** three rails × lifecycle. Mitigate with the strategy pattern, a contract test suite per rail, and real-Postgres tests (pattern: `server/__tests__/jobEditRace.db.test.js`).

---

## 15. Metrics

**Mix and conversion**
- Rail mix by country (jobs and GMV).
- Default rail acceptance vs downgrades.
- Hold success rate; 3DS challenge and success rate; auth expiry incidents.

**Payments outcomes**
- Reauthorization completion rate (PR #492) and time-to-reauthorize.
- Dispute rate per rail; refund rate.

**Credit**
- Top-up conversion; Credit float and breakage.
- Cash-out volume and latency; partner failure rate.
- FX spread revenue vs complaints.

**Offline**
- Fee collection rate; report and ban rate.
- Offline → protected upgrade rate.

**Data quality, tax, privacy, notifications**
- Rounding/reconciliation exceptions (`reconciliationExceptions`).
- Tax calculation coverage.
- Erasure SLA.
- Notification delivery by country/channel.

---

## 16. OPEN DECISIONS (lock one by one)

1. **Stripe charge model for international.**
   - Options:
     - (a) Keep direct charges (helper is merchant of record; per-country Connect).
     - (b) Destination charges + `on_behalf_of` (platform orchestrates, cross-border payouts where supported).
     - (c) Separate charges & transfers.
   - **Recommended: (b)**. It keeps the helper as the settlement merchant while enabling platform-held funds and better cross-border coverage.
2. **Connect account type.**
   - Options: (a) Express (today); (b) Custom; (c) Standard.
   - **Recommended: (a) Express.** Least build; Stripe-hosted KYC in all supported countries.
3. **Credit rail semantics.**
   - Options:
     - (a) Credit hold is the *payment* (finalize to helper).
     - (b) Keep collateral-only (today) and require Stripe for payment.
     - (c) Hybrid per country.
   - **Recommended: (a)** where legally cleared, with (b) as the fallback per country.
4. **Currency of record / FX ownership.**
   - Options:
     - (a) Job priced in the customer's currency, Stripe FX to helper.
     - (b) Job priced in the helper's currency, the customer sees a converted estimate.
     - (c) Single platform currency (USD).
   - **Recommended: (b)**. Price in the helper's currency; show the customer an estimate; no OxSteed markup on the Stripe rail.
   - 4b. **FX spread on the credit rail:** (a) none; (b) fixed % from the fee schedule. **Recommended: (b) ≤ 1%**, disclosed.
5. **Holds for local methods that can't do manual capture.**
   - Options:
     - (a) Card-only escrow.
     - (b) Capture immediately into the platform balance and transfer on completion.
     - (c) Offer the method only on non-escrow jobs.
   - **Recommended: (b)** for SEPA/iDEAL-class methods, after LEGAL REVIEW (funds held by the platform).
6. **Downgrade rule after acceptance.**
   - Options: (a) never; (b) before `in_progress` with both consents; (c) any time with both consents.
   - **Recommended: (b).**
7. **Fee level by rail.**
   - Options: (a) same % everywhere; (b) credit cheaper; (c) country-specific.
   - **Recommended: (c)**, with a credit discount allowed via the fee schedule.
8. **Offline fee model.**
   - Options: (a) upfront % from Credit at acceptance; (b) flat listing fee; (c) helper subscription; (d) free (growth).
   - **Recommended: (a)**, capped per month, with (c) as an option for power helpers. Not refunded on cancellation.
9. **Tips fee.**
   - Options: (a) 0%; (b) processing cost only; (c) standard fee.
   - **Recommended: (a) 0%**. The platform absorbs processing.
10. **Anti-leakage enforcement in chat.**
    - Options: (a) none; (b) nudge only; (c) mask contact info before acceptance.
    - **Recommended: (c) before acceptance, (b) after.**
11. **Bid currency.**
    - Options: (a) must match the job currency; (b) any, converted at acceptance.
    - **Recommended: (a).**
12. **Retention after erasure.**
    - Options:
      - (a) Delete everything.
      - (b) Pseudonymize financial and audit records, keeping them for the statutory period.
      - (c) Keep as is.
    - **Recommended: (b)**. EU revision retention 24 months, private fields stripped after 90 days.
13. **Tax responsibility.**
    - Options:
      - (a) Tax on the OxSteed fee only.
      - (b) Also act as marketplace facilitator for service tax where required.
    - **Recommended: (a) now, (b) per country after TAX REVIEW.**
14. **Credit cash-out gating.**
    - Options:
      - (a) Closed loop only (no cash-out).
      - (b) Cash-out after a KYC + holding period + caps via partners.
      - (c) Unrestricted.
    - **Recommended: (b)** where licensed, otherwise (a). 7-day hold, KYC level 2, per-country caps.
15. **Offline trust bar.**
    - Options:
      - (a) Didit-verified helper only.
      - (b) Both parties verified.
      - (c) Verified helper + a first-job value cap for new customers.
    - **Recommended: (c).**
16. **Pilot countries.**
    - Options: (a) CA/GB/IE (Stripe); (b) + HT/KE (offline/credit); (c) EU broad.
    - **Recommended: (a)** for phase 1, then HT/KE for phases 3–4 after legal sign-off.
17. **Auth-expiry strategy for long jobs (Stripe).**
    - Options:
      - (a) Proactive reauthorization before expiry (reuse PR #492).
      - (b) Capture to the platform balance at acceptance.
      - (c) Limit job duration.
    - **Recommended: (a)**, with (b) for jobs scheduled more than 5 days out.

---

## LOCKED DECISIONS (Emile, Oct 12, 2026)

1. Stripe international charges: platform routes the payment to the helper, helper is the settlement merchant (on_behalf_of + destination).
2. Connect account type: Express.
3. Credit hold = actual payment where legally cleared; collateral as fallback elsewhere.
4. Currency of record: helper's currency; customer sees an estimate; no markup on Stripe.
   4b. FX spread on Credit conversions: up to 1%, disclosed before confirming.
5. Local methods without auth/capture: charge immediately and hold funds on platform, after legal review.
6. Switching to a less protected rail after acceptance: only before work starts, with both parties' consent.
7. Fees set per country; Credit discount allowed.
8. Offline jobs require a subscription; no per-job fee. (Replaces the upfront-% recommendation.)
9. Tips carry only payment processing costs; OxSteed keeps no fee.
10. Contact details hidden in chat before acceptance; gentle reminders after.
11. Bids must match the job's currency.
12. Erasure: financial records kept pseudonymized for the legal period; EU edit history 24 months; private fields stripped after 90 days.
13. Tax: helpers responsible for all tax; OxSteed collects none. RISK: many EU/UK/APAC jurisdictions require marketplaces to collect VAT/GST on their own fee and sometimes the service (e.g. EU DAC7/deemed-supplier, UK, AU); each launch country needs tax review before go-live.
14. Credit cash-out: identity check, 7-day hold and caps via licensed partners; spend-only where no partner exists.
15. Offline jobs: verified helper required, plus a first-job value cap for new customers.
16. Pilot: CA/GB/IE first, then HT/KE after legal sign-off.
17. Card hold expiry: reauthorize before expiry; jobs scheduled more than 5 days out are charged immediately and held on platform.
