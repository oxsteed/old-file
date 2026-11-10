# Careers marketplace handoff (PR #712)

Branch `codex/credit-kiosk-release-evidence`, PR #712, base `old-files-claude`
(https://github.com/oxsteed/old-file/pull/712).

## Goal

The owner asked for everything that can be built in code so that OxSteed
Careers beats hireonthespot.com (HOTS) and Indeed. Every feature must be
complete, not a stub. Risky features sit behind flags that are off by
default. Every feature needs tests.

## Source report, summarized (hots-vs-oxsteed-careers-2026-11-10.md)

HOTS is a WordPress job board (Superio, WP Job Board Pro), launched Oct 12,
2026 as a beta.

**What HOTS had that OxSteed lacked (24 items):**

- job alerts;
- save and share jobs;
- follow employers;
- an employer directory;
- employer private messaging;
- about 40k imported jobs;
- date-posted and experience filters, sorting and page size;
- SMS alerts;
- Google/Outlook calendar free/busy booking with a video link;
- interview reschedule;
- an interview tips page;
- report a posting;
- plans at $299/$799/$2,499 with a free trial;
- two-way messaging;
- a "hires on the spot" same-day badge;
- agency and recruiter sourcing;
- an "Online now" candidate status;
- an AI résumé match (claims a ≥65% threshold);
- candidate alerts;
- an affiliate program paying 15% recurring for 6 months;
- external or email apply;
- an employer page showing phone and map.

**Where OxSteed was only partial (14 items):**

- the search UI (no pay filter, industry or sort);
- saved searches not wired to Careers;
- messaging not wired to applications;
- SMS not used by Careers;
- interviews without free/busy, self-booking, reschedule or a video room;
- talent search for restaurants only;
- boosts and hiring events paid and flagged off;
- AI ranking and extraction off, no résumé parsing;
- no self-entered work history, education or licenses;
- referrals not tied to Careers;
- no report-job button;
- follow existing only in Media;
- no employer directory.

**Announced by HOTS but not live:** ATS integrations, job fairs in 2027,
and paid candidate services.

## Indeed features found (primary sources)

Full list with citations: `docs/careers/marketplace.md` §17.

- Job alerts: https://www.indeed.com/help/job-seekers/articles/204488890-starting-stopping-and-managing-job-alerts
- My Jobs (saved, applied, interviews, archived): https://www.indeed.com/help/job-seekers/topics/200771634-my-jobs
- Company pages, reviews (five categories), Q&A and salaries:
  - https://www.indeed.com/help/employers/articles/204747960
  - https://www.indeed.com/help/employers/articles/205297680
  - https://www.indeed.com/hire/resources/howtohub/indeed-employer-reviews
- Report a job: https://www.indeed.com/help/job-seekers/articles/360028156452-how-to-report-a-job
- Message templates: https://www.indeed.com/help/employers/articles/360027383692
- Interview scheduling (employer picks the time, candidate confirms, .ics file, text reminders, video link, private notes): https://www.indeed.com/help/employers/articles/how-to-use-the-indeed-scheduling-tool-to-schedule-interviews
- Screener questions, with required questions moved to Rejected:
  - https://www.indeed.com/hire/resources/howtohub/how-to-use-screener-questions-on-indeed
  - https://www.indeed.com/help/employers/articles/setting-up-screening-criteria
- Résumé builder and PDF: https://www.indeed.com/help/job-seekers/articles/4408783727629-uploading-a-resume-file-to-your-profile
- Smart Sourcing (search, saved-search alerts, 14-day trial, $520/mo):
  - https://ca.indeed.com/help/employers/articles/360015979211
  - https://www.indeed.com/employers/solutions/smart-sourcing
- Agencies: https://www.indeed.com/help/employers/articles/360018069792
- Analytics: https://www.indeed.com/hire/resources/howtohub/insights-from-your-indeed-performance-reports
- Hiring events: https://ca.indeed.com/help/employers/articles/how-to-use-the-indeed-hiring-events

## Done, by commit (all pushed)

| Commit | What |
|---|---|
| 42b6a900f | Schema migration `20261110150000_careers_marketplace.sql`, catalog and flags |
| 7b1e2623a | Services in `server/services/careers/marketplace/*` |
| ad7ff24fe | API routes, Stripe plan webhook, sweeps in `jobs/careersJobs.js` |
| 400aafb2a | Server DB and unit tests, plus the CI step |
| bd3a49186 | Client API (`api/careers.js`) and `marketplaceModel` with its test; `client/package.json` change kept because `test:careers` needs it |
| 6a42241e3 | Job seeker UI: filters, sort and paging; save, share, follow and report; screeners; tracker; alerts; résumé builder; settings; employers, salaries, tips and video room pages |
| f170692b2 | Employer UI: inbox, scheduling, analytics, sourcing, company page, plan, agencies, application extras, screener editor |
| ea7226a27 | Admin: job and message reports, content moderation, referral payouts |
| 1fef7f006 | i18n for all 20 locales (en/es/fr/ht/ar translated; Arabic has all six plural forms) and CSS with logical properties |
| f70c30d11 | Growth data-track keys, ru and bn locale shard loaders, `careersMarketplace.browser-check.cjs` |
| b368aa10c | Test that the team view never exposes the video room key |
| ded0247c2 | `docs/careers/marketplace.md` (implementation, comparison table, skipped items, launch checklist) and new flags in `docs/careers/README.md` |

Local results at ded0247c2, all passing:

- client `npm run build:ci`;
- `node --test scripts/*.test.mjs` (674 tests);
- src unit tests (135);
- growth `--check` (coverage 1.0);
- the new browser check (3 tests);
- server careers jest: 4 suites, 109 tests.

## Left to do

1. **PR #712 title and description.** The current title, "Record exact-image
   kiosk pilot verification", is stale. Rewrite it for the careers
   marketplace (keep a line about the earlier kiosk docs commit 83890bbea).
   List the features with commits and flags, the skipped items, the Indeed
   sources, the tests, and the ops steps. Use `gh pr edit 712 --repo
   oxsteed/old-file --title ... --body-file ...`.
2. **CI.** Run 42849951932 was in progress for b368aa10c when I stopped. The
   later push of ded0247c2 starts a new run. Watch it until it is fully
   green: `gh run list --repo oxsteed/old-file --branch
   codex/credit-kiosk-release-evidence`. No failing jobs were known at
   handoff.
3. **Known gaps, already documented:**
   - Per-card search impressions are not sent; the analytics impressions
     metric stays at 0 until a batched endpoint exists.
   - Job fairs, the ~40k imported listings and scraping were skipped on
     purpose (`marketplace.md` §18).
4. **Bugbot** could not run (usage limit). No review comments are pending.

## Feature flags (all off or empty by default)

- `CAREERS_PLANS_ENABLED`, `CAREERS_STRIPE_PRICE_PLAN_STARTER`, `_GROWTH`,
  `_PRO`, `CAREERS_PLAN_TRIAL_DAYS` (14), `CAREERS_STRIPE_WEBHOOK_SECRET`
- `CAREERS_REFERRALS_ENABLED`, `CAREERS_REFERRAL_RATE_BPS` (1500),
  `CAREERS_REFERRAL_MONTHS` (6)
- `CAREERS_CALENDAR_GOOGLE_ENABLED`, `CAREERS_GOOGLE_CLIENT_ID`, `_SECRET`
- `CAREERS_CALENDAR_MICROSOFT_ENABLED`, `CAREERS_MICROSOFT_CLIENT_ID`,
  `_SECRET`, `_TENANT` (common)
- `CAREERS_OAUTH_CALLBACK_BASE`
- `CAREERS_VIDEO_ROOM_ENABLED`, `CAREERS_WEBRTC_ICE_SERVERS`
- `CAREERS_SMS_ENABLED` (Twilio through the existing `smsNotificationService`)
- `CAREERS_AI_RESUME_PARSE_ENABLED` (`CAREERS_OLLAMA_MODEL`/`_DIGEST`)
- `CAREERS_AI_MATCH_ENABLED` (`CAREERS_OLLAMA_RANK_MODEL`/`_DIGEST`, plus
  the AI ranking gate: `CAREERS_AI_RANKING_ENABLED` and a per-market bias
  audit)

## Ops and legal steps before turning flags on

Full checklist: `marketplace.md` §19.

- **Stripe:** create the recurring prices, add the subscription events to
  the webhook, and approve the auto-renewal terms.
- **Referrals:** program terms and payout tax handling (W-9/1099).
- **Google:** OAuth client with `calendar.freebusy`, consent-screen
  verification, and the redirect `<base>/api/careers/calendar/google/callback`.
- **Microsoft:** Entra app with `Calendars.ReadBasic`, `User.Read` and
  `offline_access`.
- **Video room:** your own TURN server and a privacy notice review.
- **SMS:** 10DLC/toll-free registration and TCPA consent copy.
- **Ollama:** pin the models and digests; for AI match, the bias audit and
  NYC/EU/UK sign-offs.
- **Reviews and salaries:** moderation policy review and DSA
  notice-and-action handling.

## Hard rules

- AI runs only on self-hosted Ollama. Email goes only through Resend. No
  paid outside vendors.
- All UI copy goes in all 20 locales. en, es, fr, ht and ar must be written
  out (not English placeholders) and RTL-safe. Pass
  `scripts/verify-i18n.mjs`: key and placeholder parity, and no strings of
  25+ characters identical to English.
- Migrations are named `YYYYMMDDHHMMSS_name.sql`.
- Keep the #709/#710 security patterns: token allow-list, optional auth,
  CSV hardening, socket rooms carrying IDs only, HTML escaping, nosniff,
  and PII redaction (none in sockets or logs). New code also follows the
  existing permissions, rate limits, audits, consent and erasure patterns.
- Never touch P3-1009. Credit actions need two distinct admins.
- No force-push, rebase or amend; merge commits only. Never merge with red
  CI. Rerun only the known flakes: the WebKit install hang, the Media
  harness 429s, and the Postgres image pull. The PR stays ready for review,
  not draft.
- Build complete, long-term implementations, not stubs.
- Commit as `oxsteed <emilejeanphilippe1@gmail.com>`. Add specific paths
  only; never `git add` the node_modules symlinks.

## Local test commands

```bash
# client (from client/)
node scripts/splitLocaleCatalogs.mjs
npm run build:ci                       # includes test:careers, verify:i18n, typecheck, build
node --test scripts/*.test.mjs
find src -name '*.test.mjs' -not -path '*/node_modules/*' -print0 | xargs -0 node --test
node scripts/growthInstrumentation.mjs --check   # use --write to add data-track keys
node --test scripts/careersMarketplace.browser-check.cjs   # needs playwright-core + Chrome
# from the repo root
node scripts/growth-policy-manifest.cjs --check

# server (from server/), Postgres reachable at $URL
URL=postgresql://oxsteed:statement-test-password@127.0.0.1:5432/careers_test
psql "$URL" -c 'select 1' || createdb careers_test
DATABASE_URL=$URL node migrate.js
CAREERS_TEST_DATABASE_URL=$URL npx jest --runInBand \
  __tests__/careers.db.test.js __tests__/careersMarketplace.db.test.js \
  __tests__/careersMarketplace.unit.test.js __tests__/careersUnit.test.js
```
