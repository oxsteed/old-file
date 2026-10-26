# OxSteed Careers: operations, flags and launch checklist

This is the operator guide for OxSteed Careers (spec: *OxSteed Careers: Design Spec*, decisions Q1–Q20 of October 26, 2026).
Every vendor sits behind a provider interface in `server/services/careers/providers/`. **Every flag defaults to off.**
With no configuration the product still works (direct hiring, pipeline, offers, onboarding, invitations, rules-based matching).
Vendor-backed features answer `503 provider_not_configured` and send nothing.

## 1. Feature flags and credentials

| Variable | Default | What it turns on | Needs before enabling |
|---|---|---|---|
| `CAREERS_CHECKR_ENABLED` | `false` | Checkr background checks after a conditional offer (FCRA flow §12.4/§12.8) | Checkr **partner** account and OAuth client, FCRA counsel sign-off on the disclosure, the pre-adverse and adverse templates and the 5-business-day wait; local fair-chance review (NYC, CA, IL, etc.) |
| `CAREERS_CHECKR_CLIENT_ID` | – | Checkr partner OAuth client id (each business connects its own Checkr account; the token is stored encrypted per business) | as above |
| `CAREERS_CHECKR_WEBHOOK_SECRET` | – | HMAC secret for `POST /api/careers/webhooks/checkr` | Register the webhook URL in Checkr |
| `CAREERS_CHECKR_BASE_URL` | `https://api.checkr.com/v1` | Use the staging URL for tests | – |
| `CAREERS_EOR_ENABLED` | `false` | OxSteed as employer of record (Q1) for shift, seasonal and temporary paths | Signed EOR/payroll partner contract, EOR legal review **per market**, the partner's licence recorded per market in Admin → Careers → Employer of record |
| `CAREERS_EOR_PARTNER`, `CAREERS_EOR_API_KEY`, `CAREERS_EOR_BASE_URL`, `CAREERS_EOR_WEBHOOK_SECRET` | – | Partner adapter and webhook `POST /api/careers/webhooks/eor` | as above |
| `CAREERS_BILLING_ENABLED` | `false` | Paid boosts and hiring events (Q20) through Stripe Checkout | Stripe products/prices created, pricing approved |
| `CAREERS_STRIPE_PRICE_BOOST_7D`, `CAREERS_STRIPE_PRICE_BOOST_30D`, `CAREERS_STRIPE_PRICE_HIRING_EVENT` | – | Price ids; a plan without a price answers 503 `plan_not_priced` | as above |
| `CAREERS_STRIPE_WEBHOOK_SECRET` | – | `POST /api/careers/webhooks/stripe` (uses the existing `STRIPE_SECRET_KEY`) | Register the endpoint in Stripe |
| `CAREERS_AI_EXTRACTION_ENABLED` | `false` | Ollama suggestions of requirements, skills and wording flags (never "verified"; a person confirms) | Self-hosted Ollama with a pinned model |
| `CAREERS_AI_RANKING_ENABLED` | `false` | Global kill switch for AI applicant ranking (§10.4). Each market must also pass its gate (below) | Independent bias audit per market, NYC notice period, EU AI Act sign-off, UK DPIA |
| `GROWTH_OLLAMA_URL` | – | The **self-hosted** Ollama endpoint (shared with Growth). No outside AI and no fallback model: if Ollama or the pinned digest is missing the feature returns to rules / applied order | Ollama host on the private network |
| `CAREERS_OLLAMA_MODEL`, `CAREERS_OLLAMA_MODEL_DIGEST` | – | Extraction model and its sha256 digest (pinned; a digest mismatch disables the call) | Reviewed model |
| `CAREERS_OLLAMA_RANK_MODEL`, `CAREERS_OLLAMA_RANK_DIGEST` | – | Ranking model and digest, pinned separately so a Growth model change never changes hiring | Model covered by the bias audit |
| `CAREERS_IP_PEPPER` | falls back to `JWT_SECRET` | Pepper for hashing guest IPs in rate limits | Set a dedicated secret |
| `CAPTCHA_ENABLED`, `CAPTCHA_PROVIDER`, `CAPTCHA_SECRET` | `false` | Existing `verifyCaptcha` middleware, already in front of guest apply | **There is no client captcha widget yet** (see §5); leave off until one ships |

Identity verification uses the existing Didit integration (`DIDIT_*`). Email uses Resend through `server/utils/email.js`.

### AI ranking gate (per market)

Ranking only runs when **all** are true, otherwise the board shows applied order with a reason (`careers.ranking.neutral.*`):

1. `CAREERS_AI_RANKING_ENABLED=true` and the opening allows it.
2. The market (e.g. `US`, `US-NY`, `US-NY-NYC`) is enabled in Admin → Careers → AI ranking & fairness.
3. A current independent bias audit (reference, pass date, expiry, public summary URL) is recorded.
4. EU markets: AI Act compliance signed off. Until then ranking stays **off in the EU**.
5. UK markets: a DPIA covering ranking is recorded.
6. NYC: the 10-business-day candidate notice period has passed (Local Law 144).
7. No open impact-ratio block. The monthly fairness job (`careersJobs.fairness`) disables ranking for a scope when any impact ratio is under **0.8**. An admin must review it before it comes back.
8. The opening has confirmed requirements. The model never sees photos, names, postal codes, ratings or EEO data. Paid boosts never affect order.

## 2. Scheduled jobs

`server/jobs/careersJobs.js` (node-cron): offer expiry (every 15 min), onboarding resume (5 min), boost expiry (hourly), retention (daily 03:15), facts refresh and fairness reports. All are idempotent.

## 3. Migrations

Run through `server/migrate.js` (numeric-prefix order, timestamp names, Q11):
`20261026170000_careers_phase0_fixes.sql` … `20261026170700_careers_team_links.sql`.
`support_agent_hiring_profiles` (migration 273) is unchanged and still used for support-agent hires.

## 4. Retention

- **US:** state rules in Admin → Careers → Retention. These can never go below the **12-month federal floor**.
- **EU/UK:** 12 months.
- Every rule needs a legal source and a counsel-review mark.
- Expired applications are anonymized. Legal holds are kept.
- Privacy export and erase include careers data.

## 5. Outside work before launch (not code)

**Vendor accounts and keys**
- Checkr partner account, OAuth client and webhook. Test the full flow (invite, consent, report, pre-adverse, dispute, adverse) end to end in staging.
- An EOR/payroll partner contract and API access, plus licences for every EOR market. Markets without one offer direct hiring only.
- Stripe prices for the 7-day and 30-day boosts and for hiring events, the webhook endpoint and final pricing (Q20).
- A self-hosted Ollama host with pinned models and digests for extraction and ranking.
- A Didit production workflow for identity checks before offer acceptance.
- A captcha provider (Turnstile, hCaptcha or reCAPTCHA) **and a client widget** for guest apply, before `CAPTCHA_ENABLED` is turned on.

**Legal reviews and sign-offs**
- FCRA counsel: the disclosure and authorization, the adverse-action templates and the permissible-purpose certification text. Also each state and city fair-chance law.
- EEO: the US voluntary self-identification wording and the separate encrypted storage.
- Pay-transparency rules table (Admin → Pay rules): confirm each jurisdiction, its employee threshold and its effective date.
- Retention rules: a legal source and a counsel mark for each US state.
- EOR legal review per market (Q1).
- The age-18 minimum and any higher legal minimum ages per role and jurisdiction.

**Privacy and AI**
- A DPIA covering profiles, the share ledger, talent search, background checks and AI ranking (EU/UK).
- An independent **bias audit** per market before ranking is turned on, and NYC AEDT notice and publication of the summary.
- EU AI Act compliance sign-off. Ranking stays off in the EU until then.
- Careers privacy notice and policy section published in all 20 languages.

**Translations**
- en, es, fr, ht and ar ship in this PR (ar is right-to-left and uses logical CSS properties).
- The other **15 locales** (bn, de, hi, id, it, ja, ko, pt, ru, sw, th, tr, ur, vi, zh) carry **English placeholders** under `careers.*`. Professional translation and in-context review are needed before the launch gate (Q13).

**Pilot**
- Pick the pilot businesses (3 restaurants and 5 trades businesses, at least one in the EU or UK), turn the flags on for staging, then go live per §17.
