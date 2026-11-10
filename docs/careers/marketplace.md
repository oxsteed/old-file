# OxSteed Careers marketplace (PR #712)

This document covers the job-marketplace features added on top of the
Careers system in PR #712. It explains what each feature does, which flag
controls it, and where it lives in the code. It also compares OxSteed
Careers with hireonthespot.com (HOTS) and Indeed, feature by feature. The
code links here by section number (`marketplace.md §N`), so keep the
numbering stable.

Rules that apply everywhere:

- **No new outside vendors.** AI runs only on the self-hosted, digest-pinned
  Ollama. Email goes only through Resend (existing `notify` and `delivery`).
  Payments go through the existing Stripe account. SMS uses the existing
  `smsNotificationService` (Twilio) and is off. Calendar OAuth uses each
  interviewer's own Google or Microsoft account.
- **Risky features are off by default.** These are paid plans, referrals,
  SMS, calendar OAuth, the video room, AI résumé parsing and AI matching.
  Everything else is free and on.
- **Existing safeguards still apply.** These are hiring permissions and
  store scope (`applicationWithAccess`), rate limiters in
  `middleware/rateLimiter.js`, audits, the consent ledger, erasure and
  retention, and sockets that carry IDs only. Logs and socket payloads
  carry no PII, and CSV exports are formula-neutralized.
- **Copy is localized.** All UI copy is under `careers.mk.*` in all 20
  locales. en/es/fr/ht/ar are translated (Arabic has all six plural forms),
  and the other 15 locales hold English placeholders. Styles use logical
  properties, so RTL layouts mirror.

Migration: `server/migrations/20261110150000_careers_marketplace.sql`.
Services: `server/services/careers/marketplace/*`. Routes:
`server/routes/careers.js`. Client: `client/src/components/careers/marketplace/*`
and the new pages under `client/src/pages/Career*Page.jsx`.

## 1. Feature flags

All flags are off or empty by default. Section 1 of
[`README.md`](README.md) lists them together with the existing Careers flags.

| Flag | Turns on | Needs before turning on |
|---|---|---|
| `CAREERS_PLANS_ENABLED` | Employer subscription plans, using Stripe Checkout with a free trial (§10.1) | Stripe products/prices; `CAREERS_STRIPE_PRICE_PLAN_STARTER`, `_GROWTH`, `_PRO`; `CAREERS_STRIPE_WEBHOOK_SECRET`; pricing and terms approved |
| `CAREERS_PLAN_TRIAL_DAYS` | Trial length (default 14, one trial per business) | – |
| `CAREERS_REFERRALS_ENABLED` | Employer referral program (§10.2) | Program terms, tax and payout process. `CAREERS_REFERRAL_RATE_BPS` (default 1500 = 15%) and `CAREERS_REFERRAL_MONTHS` (default 6) |
| `CAREERS_CALENDAR_GOOGLE_ENABLED` | Google Calendar free/busy (§6.2) | Google Cloud OAuth client with the `calendar.freebusy` scope and a verified consent screen: `CAREERS_GOOGLE_CLIENT_ID`, `CAREERS_GOOGLE_CLIENT_SECRET` |
| `CAREERS_CALENDAR_MICROSOFT_ENABLED` | Outlook / Microsoft 365 free/busy (§6.2) | Entra app registration with `Calendars.ReadBasic`: `CAREERS_MICROSOFT_CLIENT_ID`, `CAREERS_MICROSOFT_CLIENT_SECRET`, `CAREERS_MICROSOFT_TENANT` (default `common`) |
| `CAREERS_OAUTH_CALLBACK_BASE` | Public API origin used to build the OAuth redirect URIs | Register `<base>/api/careers/calendar/<provider>/callback` with each provider |
| `CAREERS_VIDEO_ROOM_ENABLED` | In-house WebRTC interview room (§6.4) | `CAREERS_WEBRTC_ICE_SERVERS` (JSON array; run your own TURN for strict networks); privacy notice reviewed |
| `CAREERS_SMS_ENABLED` | Careers texts for interview reminders and offers (§15) | The existing Twilio config used by `smsNotificationService`; TCPA/10DLC registration and consent copy reviewed |
| `CAREERS_AI_RESUME_PARSE_ENABLED` | Ollama résumé parsing into suggested entries (§8.2) | Self-hosted Ollama; `CAREERS_OLLAMA_MODEL` and `CAREERS_OLLAMA_MODEL_DIGEST` |
| `CAREERS_AI_MATCH_ENABLED` | Ollama résumé-to-job match for employers (§9) | `CAREERS_OLLAMA_RANK_MODEL` and `CAREERS_OLLAMA_RANK_DIGEST`, plus everything required by the AI ranking gate: `CAREERS_AI_RANKING_ENABLED`, per-market bias audit, NYC notice period, EU AI Act / UK DPIA sign-off |

## 2. Search, filters, sort and paging

`GET /api/careers/openings` keeps its old response for callers that send
neither `page` nor a sort. With `page` or a non-default `sort`, it returns
`{openings, total, page, pages}`.

- **Filters:**
  - keywords, country, workplace, path stage, department, employer type,
    postal code with a radius;
  - **industry** (20 values in `careerCatalog.INDUSTRIES`) and
    **experience level** (no experience through executive);
  - **date posted** (1, 3, 7, 14 or 30 days);
  - **minimum pay**, normalized to hourly with the period;
  - **same-day hire**, **urgently hiring** and **visa sponsorship**.
- **Sorts:** newest, oldest, highest pay, lowest pay, relevance (full-text
  rank) and distance (needs a postal code). Page sizes are 10, 20 or 50.
- **Badges** on cards and job pages:
  - "Same-day hire" (the HOTS badge equivalent; employers set it per
    opening, and the company-page default comes from §4);
  - "Urgently hiring";
  - "Posted by a staffing agency" (§12);
  - "Usually responds within N days", computed from the median time to
    first response.
- **Client:** `CareersPage.jsx` has advanced filters, sort, numbered
  paging (`pageList`) and "Save this search as an alert" (§3). Saving needs
  sign-in; a signed-out visitor gets a login link.

## 3. Saved jobs, My jobs tracker, follows, job alerts and job reports

All of these are under `/api/careers/me/*`, and all are free and on.

- **Saved jobs and tracker.** Save, unsave, archive and restore jobs (up
  to 500). The tracker (`MyCareerApplicationsPage` → *My jobs*) shows
  applied and saved jobs, archived jobs, and "viewed by employer".
- **Share.** Uses `navigator.share` or copies the link, and counts the
  share in analytics.
- **Follow employers.** Follow a business or OxSteed HR. Followers get
  in-app and email notices when the employer posts a new public opening.
  The notice runs in the `careerJobAlerts` sweep, every 15 minutes.
- **Job alerts.** Saved searches (up to 20) with the same criteria as §2.
  Frequency is instant, daily or weekly. Channels are in-app, email, push
  and SMS; SMS needs §15 consent and the flag. Alerts can be paused and
  resumed. Each send records `last_sent_at`, so a job is never sent twice.
  `careersAlertLimiter` limits alert writes.
- **Report a job.** Reasons are scam, asks for payment, discriminatory,
  misleading pay, fake employer, offensive, not a job, or other. One report
  per person per opening. Three distinct reports flag the opening for
  moderation. Admins handle reports under Admin → Careers → Reports, where
  they can dismiss a report or remove the job (a note is required), and
  every action is audited. `careersReportLimiter` limits reports.

## 4. Employer directory, company pages, reviews, Q&A and salaries

- **Directory** at `/careers/employers`. It lists businesses with open
  public roles, plus OxSteed HR. Search by name or city, filter to verified
  employers only, and sort by open jobs, rating or name.
- **Company page** at `/careers/employers/:slug`, with tabs for jobs,
  about, reviews, Q&A and salaries. Owners edit it under Hiring →
  *Company page*: about text, why join, and whether to show the phone
  number, the address and map, and the same-day badge (HOTS shows phone
  and map).
- **Reviews.** Only people whom OxSteed records show worked there can
  review: an accepted team membership or a hired application. Owners and
  managers of the business cannot.
  - Accounts must be at least 7 days old, and each person gets one review
    per company.
  - A review has an overall rating and five category ratings (work–life,
    pay and benefits, security and advancement, management, culture), plus
    pros, cons, headline and an optional job title. Reviews are anonymous.
  - Text with contact details or links is held for moderation.
  - Three distinct reports hide a published review until a moderator
    decides.
  - The business can reply publicly but can never edit or remove a review.
- **Q&A.** Any signed-in user can ask. Current and former employees and
  the employer can answer, and employer answers are labelled. The same
  hold rules apply.
- **Salaries** at `/careers/salaries` and on each company page. They
  combine posted pay ranges with anonymous salary reports from verified
  current or former employees.
  - Figures are normalized to hourly (2,080 h/year) and shown as P10, P25,
    median, P75 and P90.
  - Individual reports count only once at least 5 people have reported the
    same normalized title. Below that, the page says there isn't enough
    data yet.
- **Moderation** of held content is under Admin → Careers → *Reviews and
  Q&A*. `careersContentLimiter` limits writes.

## 5. Two-way messaging

The thread belongs to one application, between the candidate and the
scoped hiring team (`messaging.js`). The team inbox is at Hiring → *Inbox*,
and candidates see the thread on the application.

- **Access.** The candidate on their own application, or staff who pass
  `applicationWithAccess` (hiring permission and store scope). Everyone
  else gets 404.
- **Moderation.**
  - `messageSanitizer` masks phone numbers and flags off-platform contact.
    The client shows a scam warning.
  - Either side can report a message. Admins hide it from Admin → Careers
    → Reports.
- **Closed threads.** User blocks and Careers mutes close the thread both
  ways. Guest-only and anonymized applications cannot message. A thread
  closes once the application is in a final stage and
  has had no activity for 30 days.
- **Rate limits.**
  - `careersMessageLimiter` on HTTP.
  - 30 messages per sender every 10 minutes.
  - 200 new employer-started conversations per business per day.
- **Templates.** Up to 50 reply templates per business, with
  `{openingTitle}` and `{employerName}` placeholders.
- **Realtime and notices.**
  - `careers:message` socket events carry `{threadId, applicationId}` only.
  - Email and in-app notices never include the message body.
  - Employer messages show the business name, not the staff member's name.

## 6. Interview scheduling

### 6.1 Availability

Each interviewer sets weekly windows (up to 28) in an IANA time zone, under
Hiring → *Scheduling*. Slots skip existing interviews and connected-calendar
busy blocks, and must be at least 2 hours ahead.

### 6.2 Proposals, self-booking and calendar free/busy

- **Proposals.** The team sends a proposal from the application: either
  hand-picked times, or every free slot from availability (up to 20). A
  proposal expires after 72 hours by default.
- **Booking.** The candidate books a slot. The booking row-locks and
  re-checks for conflicts, so two candidates can't take the same time. The
  candidate can also decline and ask for other times. Booking calls
  `applications.scheduleInterview`, so the stage move, the ICS invite and
  the candidate notice stay in one place.
- **After booking.** The candidate confirms attendance. Either side can
  request or make a reschedule. Updated ICS files keep the UID and raise
  `SEQUENCE`, so calendars update in place. The `careerInterviewSweep`
  sends one reminder within 24 hours of the interview and expires stale
  proposals.
- **Private notes.** Interviewer notes, 1–5 ratings and an
  advance/hold/decline recommendation are never shown to the candidate.
- **Calendar free/busy** (`calendarSync.js`):
  - Google uses the `calendar.freebusy` scope; Microsoft Graph uses
    `Calendars.ReadBasic` with `getSchedule`.
  - OAuth uses the authorization code flow with PKCE. The state is single
    use and lasts 10 minutes, and the return path must be same-origin.
  - Tokens are encrypted with AES-256-GCM and deleted on disconnect or
    erasure. Event titles and attendees are never read.
  - Each provider stays off until its flag and OAuth client are configured.
- **ICS fallback.** Every interview email carries an `.ics` file. Both
  sides can download it again from the app, and it is served with
  `nosniff`.

### 6.3 SMS reminders

When the candidate opted in (§15) and `CAREERS_SMS_ENABLED=true`, the team
can tick "also send a text reminder".

### 6.4 In-house video room

The room is at `/careers/interview-room/:id` (`realtime/careersInterviewRoom.js`).

- **Media.** WebRTC media flows peer to peer, or through the operator's own
  TURN server from `CAREERS_WEBRTC_ICE_SERVERS`. The server only relays SDP
  and ICE messages between sockets already admitted to the room.
- **Admission.** Checked against the database on every join: the candidate
  on their own application, or a hiring-team member with opening and
  store-scope access. The room opens 15 minutes before the interview and
  closes 60 minutes after. At most 4 sockets can be in a room.
- **Room key.** The room key is random and is a capability secret. The team
  view gets only `has_video_room`, which a test asserts.
- **Payloads.** Signal payloads are size-capped and rate-limited, and are
  never logged or stored. Peer events carry socket IDs and a side, no
  names.
- **No recording.** The UI says so.

## 7. Screeners and deal-breakers

Employers add up to 10 questions per opening under Opening editor →
*Screener questions*. A question is either a catalog preset or custom text.

- **Presets:** work authorization, 18+, driver's license, reliable
  transport, commute, relocate, shifts, years of experience, certification,
  language, education, lifting and start date.
- **Deal-breakers.** Only presets with an objective expected answer can be
  deal-breakers (yes, a minimum number of years, a minimum education level,
  any-of choices). Custom prompts that ask about protected characteristics
  are refused.
- **Auto-reject.** With `screener_auto_reject` on, an application that
  misses a deal-breaker is moved to rejected with reason
  `requirements_not_met`. The rejection names the requirement, and the
  candidate can dispute it as with any rejection.
- **What candidates see.** Expected answers are never sent to candidates.
  Signed-in workers can save preset answers as defaults, which prefill
  later applications.
- **Retention.** Answers are stored on the application and cleared by
  retention (§11).

## 8. Structured profile and résumé builder

### 8.1 Self-reported entries and PDF

- **Entries.** Work history (up to 30), education (up to 10) and licenses
  or certificates (up to 20). License numbers are never stored.
- **Self-reported label.** Every entry is labelled **Self-reported /
  Unverified**. Entries are kept apart from OxSteed-verified facts
  (`career_profile_facts`) and never mixed with them.
- **Résumé PDF** in en/es/fr/ht/ar. Arabic text uses Noto Sans Arabic and is right-aligned. Verified
  facts get their own section. Contact details are included only when the
  worker asks.

### 8.2 Résumé parsing (flag: `CAREERS_AI_RESUME_PARSE_ENABLED`)

- **Input.** The uploaded résumé (PDF, DOCX or text) or pasted text.
  Extraction is bounded: 5 MB input, a 20 MB inflate cap and 400 streams.
- **Redaction.** Emails, phone numbers, URLs, street addresses and the
  worker's name are removed before the self-hosted Ollama sees the text.
- **Review.** The output is a list of suggestions. The worker reviews each
  one and imports it, and nothing is saved before that.

## 9. AI match (flag: `CAREERS_AI_MATCH_ENABLED`)

The match runs only when the existing AI ranking gate also passes:

- the global flag;
- a per-opening opt-in, shown to applicants;
- a market with a current bias audit;
- EU AI Act / UK DPIA sign-offs;
- no open impact-ratio block;
- the NYC notice period.

What the model sees and what employers get:

- **Model input.** Job-related data only: role titles with months of
  experience, credential names, skills and verified fact types. The model
  never sees names, contact details, employers, schools, places or EEO
  data.
- **Output.** Employers get a band (strong, partial or limited) with
  met/gap reasons, never a bare score. The result is advisory: there is no
  auto-reject, and a person reviews every application.

## 10. Plans and referrals

### 10.1 Employer plans (flag: `CAREERS_PLANS_ENABLED`)

Posting, messaging, scheduling and screeners are free on every plan. Plans
raise limits on sourcing tools:

| Plan | Candidate alerts | Shortlists | Talent invites / month | Analytics CSV | Agency clients |
|---|---|---|---|---|---|
| Free | 1 | 1 | 25 | – | 0 |
| Starter | 5 | 5 | 100 | ✓ | 0 |
| Growth | 20 | 20 | 400 | ✓ | 5 |
| Pro | 100 | 100 | 2,000 | ✓ | 50 |

- **While the flag is off,** every business gets the Pro limits, so turning
  plans on never breaks a hire in progress.
- **Checkout.** Stripe Checkout in subscription mode, with one free trial
  per business. Card changes and cancellation go through the Stripe Billing
  Portal.
- **Webhooks.** `/api/careers/webhooks/stripe` checks signatures,
  de-duplicates events in `career_stripe_events`, and maps subscription
  status.
- **Return URL.** Checkout returns to
  `/business/:id/workspace/hiring?hire_tab=plan`.

### 10.2 Referral program (flag: `CAREERS_REFERRALS_ENABLED`)

- **Codes.** Any signed-in user can get a code. A business owner can attach
  one code, once, before the business's first paid plan.
- **Commission.** Paid plan invoices inside the window (default 6 months)
  accrue a commission (default 15%, matching the HOTS affiliate terms).
- **Payouts.** A payout needs two distinct admins (first and second
  approval), then a manual "paid" mark with a reference. There is no
  outside payout vendor.
- **Refunds and self-referral.** Refunds void unpaid commissions.
  Self-referral is refused, meaning the referrer is the owner or a member
  of the referred business.

## 11. Privacy, consent, export and erasure

- **Export.** The Careers export includes saved jobs, follows, alerts,
  messages (hidden messages without their body), proposals, screener
  defaults and the self-reported résumé.
- **Erasure.** Deletes the user's own marketplace content: saves, follows,
  alerts, defaults, résumé entries, calendar connections and tokens,
  availability, shortlist entries, candidate-alert hits, reviews, questions
  and answers.
- **Retention anonymization.** Removes message threads, AI match scores,
  interview notes, proposal free text and screener answers.
- **Audit log.** Sensitive employer reads are still recorded in the
  access log.

## 12. Staffing agencies and recruiters

An agency is an ordinary verified OxSteed business (`agency.js`).

- **Linking.** An agency hiring manager requests a link to a client
  business with permissions: `post_openings`, `manage_pipeline` and
  `source_talent`. Only the client's owner can approve, narrow or revoke
  the link, and either owner can end it.
- **What an active link allows.**
  - Agency staff can post openings for the client. These are labelled
    "Posted by a staffing agency" and show the real employer.
  - Agency staff can manage the pipeline of the openings they posted.
  - With `source_talent`, agency staff can search talent for the client.
  - Every write is audited in both businesses' logs.
- **Plan limits.** The number of clients is limited by the agency's plan
  (§10.1).

## 13. Sourcing: candidate search, available now, candidate alerts, shortlists

- **Candidate search.** Open to **every verified business**, not just
  restaurants. Search is near the business address (or a restaurant
  store), with an "available now" filter and badge.
- **Consent model.** The existing one applies: only searchable profiles
  appear, mutes, bans and search locks apply, and invitation caps stay
  (50 per day, 3 per worker per 30 days).
- **New-candidate alerts.** Run hourly in `careerCandidateAlerts`. A notice
  carries a count and the alert name only, and links back to a logged
  search.
- **Shortlists.** Lists of people to invite later. A person who becomes
  hidden shows as "no longer visible".

## 14. Analytics

Hiring → *Analytics* shows, per opening, for 7, 30 or 90 days:

- the funnel: impressions, views, apply starts, applications, interviews,
  offers, hires, and screened out;
- saves and shares;
- the median time to first response;
- daily views.

The data is counts only, with no applicant identities. CSV export is
formula-neutralized and gated by the plan when plans are on.

Views, apply starts and shares are recorded from the job page. Careers
search sends batches of opening IDs to `POST /api/careers/openings/impressions`
as cards become at least half visible in a foreground tab. This requires
analytics consent and honors Global Privacy Control. Listing requests
are read-only.

The rate-limited endpoint accepts up to 60 IDs and counts only currently
public openings. A short-lived daily keyed hash of the signed-in account
or guest IP deduplicates repeated exposures, including promoted and
organic placements. The marks and daily totals update atomically. The
existing nightly job prunes old marks, and the dashboard exposes aggregate
counts. Job-page views can also come from direct links or visitors who
decline analytics, so the two counts cover different audiences.

## 15. Worker settings: available now, SMS, saved screener answers

- **Available now.** Opt-in, for 1 to 24 hours, then it switches off on its
  own. It is never a live online tracker.
- **Careers SMS consent.** Recorded separately with a timestamp, and it
  mirrors `notification_preferences.sms_careers`. Nothing is sent unless
  `CAREERS_SMS_ENABLED=true` and the phone is verified. STOP is honoured by
  the existing SMS service.
- **Saved screener answers.** The defaults from §7.

## 16. Interview tips

`/careers/interview-tips` is a static, localized page with sections on
before the interview, common questions, STAR, video, phone, in person,
after the interview, and your rights. It is linked from the job search page and from the
candidate's interview card.

## 17. Comparison: OxSteed Careers vs HOTS vs Indeed

**Legend:**

- ✓ = available.
- ✓ (flag) = built here, off until the flag in §1 is turned on.
- – = not offered, or not found in public sources.

HOTS facts come from the public site, checked Nov 10, 2026 (sources listed
after the table). Indeed facts come only from Indeed's own help center and
employer resources (sources listed after the table).

| Feature | HOTS | Indeed | OxSteed Careers (this PR) |
|---|---|---|---|
| Job alerts from a saved search | ✓ [H1] | ✓ daily/weekly email [I1] | ✓ instant/daily/weekly; in-app, email, push, SMS (flag) — §3 |
| Save jobs / My jobs tracker | ✓ [H1] | ✓ saved/applied/interviews/archived [I2][I3] | ✓ saved/applied/archived, "viewed by employer" — §3 |
| Share a job | ✓ [H1] | – | ✓ — §3 |
| Follow employers | ✓ [H2] | ✓ company alerts [I1] | ✓ — §3 |
| Employer directory | ✓ [H2] | ✓ company search [I7] | ✓ — §4 |
| Company page with jobs/about | ✓ [H3] | ✓ [I4] | ✓ with phone/map toggles — §4 |
| Employee reviews with category ratings | – | ✓ five categories [I6][I7] | ✓ same five categories, only from people OxSteed records show worked there — §4 |
| Company Q&A | – | ✓ [I4][I5] | ✓ — §4 |
| Salary insights | – | ✓ from employee reviews and job postings [I8] | ✓ percentiles, minimum of 5 reports — §4 |
| Filters: date posted, experience, pay, sort, page size | ✓ [H1] | not checked | ✓ plus industry, same-day, urgent, sponsorship, distance sort — §2 |
| Report a job | ✓ [H4] | ✓ [I9] | ✓ reasons, auto-flag, admin queue — §3 |
| Two-way messaging | ✓ [H3] | ✓ with templates [I10] | ✓ moderated, rate-limited, templates — §5 |
| Interview scheduling: candidate picks a time | ✓ [H5] | employer picks the time and the candidate confirms [I11]; time slots only for hiring events [I12] | ✓ availability, proposals, self-booking — §6 |
| Confirm / reschedule | ✓ (inferred) [H1] | ✓ [I2][I11] | ✓ both sides, ICS SEQUENCE — §6 |
| Calendar free/busy (Google/Outlook) | ✓ [H5] | – (an .ics invite only [I11]) | ✓ (flag), with ICS fallback — §6.2 |
| Built-in video interview | ✓ video link [H5] | ✓ Indeed video [I11] | ✓ (flag) in-house WebRTC, not recorded — §6.4 |
| SMS reminders | ✓ [H6] | ✓ text reminders [I11] | ✓ (flag) — §6.3, §15 |
| Interview notes / ratings | – | ✓ private notes [I11] | ✓ notes, 1–5, recommendation — §6.2 |
| Screener questions | – | ✓ [I13][I14] | ✓ up to 10 — §7 |
| Deal-breakers / auto-reject | – | ✓ required → Rejected [I13][I14] | ✓ presets only, transparent rejection reason, disputable — §7 |
| Résumé builder + PDF | – | ✓ build, edit, download [I15][I16] | ✓ self-reported entries labelled unverified, verified facts in their own section, 5 languages — §8 |
| Résumé parsing | – | – (uploads are converted to PDF [I15]) | ✓ (flag) self-hosted Ollama with redaction first — §8.2 |
| AI résumé-to-job match | ✓ claimed [H7] | ✓ Smart Screening criteria and AI Recruiter follow-ups [I14] | ✓ (flag) behind bias-audit gates, advisory only — §9 |
| Candidate search / sourcing | ✓ [H8] | ✓ Smart Sourcing (paid) [I17][I18] | ✓ every verified business, consent-based — §13 |
| New-candidate alerts | ✓ (inferred) [H1] | ✓ saved-search alerts (Smart Sourcing) [I17] | ✓ count-only notices — §13 |
| "Online now" / same-day badge | ✓ [H7][H3] | – | ✓ "Available now" (opt-in, expires) and "Same-day hire" — §2, §15 |
| Employer plans with free trial | ✓ $299/$799/$2,499 [H9] | ✓ Smart Sourcing $520/mo, 14-day trial [I18][I19] | ✓ (flag) Stripe, one trial per business — §10.1 |
| Referral / affiliate program | ✓ 15% for 6 months [H9] | – | ✓ (flag) 15% for 6 months, two-admin payouts — §10.2 |
| Agencies / recruiters for clients | ✓ [H4] | ✓ with client authorization [I20] | ✓ client-approved permission sets, audited both sides — §12 |
| Job analytics | – | ✓ impressions, clicks, applies [I21] | ✓ funnel, response time, CSV — §14 |
| Interview tips content | ✓ [H10] | ✓ career guide [I3] | ✓ 5 languages — §16 |
| Verified work history, FCRA disputes, EEO, fairness gates, 20 locales | – | – | ✓ (existing Careers) |
| Job fairs / hiring events (candidate sign-up) | announced for 2027 [H11] | ✓ hiring events [I22] | skipped (§18) |
| Large imported job feed | ✓ about 40k imported [H1] | ✓ aggregator | skipped (§18) |

### HOTS sources

- [H1] https://www.hireonthespot.com/jobs/ and https://www.hireonthespot.com/job/sales-consultant/
- [H2] https://www.hireonthespot.com/employers/
- [H3] https://www.hireonthespot.com/employer/family-dollar/
- [H4] https://www.hireonthespot.com/faq/
- [H5] https://www.hireonthespot.com/privacy-policy/
- [H6] https://www.hireonthespot.com/terms/ §18
- [H7] https://www.linkedin.com/company/hire-on-the-spot (company description)
- [H8] HOTS FAQ "contact candidates directly" — https://www.hireonthespot.com/faq/
- [H9] https://www.hireonthespot.com/affiliate-program/, https://wefunder.com/hireonthespot
- [H10] https://www.hireonthespot.com/interview-tips/
- [H11] https://www.hireonthespot.com/job-fairs/

### Indeed sources (primary: indeed.com help center and employer resources)

- [I1] Managing Job Alerts — https://www.indeed.com/help/job-seekers/articles/204488890-starting-stopping-and-managing-job-alerts
- [I2] My Jobs — https://www.indeed.com/help/job-seekers/topics/200771634-my-jobs
- [I3] How to find jobs you applied for — https://www.indeed.com/career-advice/finding-a-job/how-to-find-jobs-applied-for-on-indeed
- [I4] About Indeed Company Pages — https://www.indeed.com/help/employers/articles/204747960
- [I5] FAQs: Company Pages — https://www.indeed.com/help/employers/articles/faq-company-page
- [I6] Managing Company Reviews — https://www.indeed.com/help/employers/articles/205297680
- [I7] Indeed Employer Reviews — https://www.indeed.com/hire/resources/howtohub/indeed-employer-reviews
- [I8] About Indeed Company Pages, salaries section ("averages from employee reviews and job postings") — https://www.indeed.com/help/employers/articles/204747960
- [I9] How to Report a Job — https://www.indeed.com/help/job-seekers/articles/360028156452-how-to-report-a-job
- [I10] Manage Message Templates — https://www.indeed.com/help/employers/articles/360027383692
- [I11] Scheduling Interviews on Indeed — https://www.indeed.com/help/employers/articles/how-to-use-the-indeed-scheduling-tool-to-schedule-interviews
- [I12] Creating an Indeed Hiring Event (candidate-selected time slots) — https://ca.indeed.com/help/employers/articles/how-to-use-the-indeed-hiring-events
- [I13] How to Use Screener Questions on Indeed — https://www.indeed.com/hire/resources/howtohub/how-to-use-screener-questions-on-indeed
- [I14] Setting up Screening Criteria (Smart Screening) — https://www.indeed.com/help/employers/articles/setting-up-screening-criteria
- [I15] Creating a Resume on Indeed — https://www.indeed.com/help/job-seekers/articles/4408783727629-uploading-a-resume-file-to-your-profile
- [I16] How to Share, Download, and Print a Profile — https://support.indeed.com/hc/en-us/articles/204289064-How-to-Share-Download-and-Print-a-Profile
- [I17] Source Candidates on Indeed — https://ca.indeed.com/help/employers/articles/360015979211
- [I18] Indeed Smart Sourcing — https://www.indeed.com/employers/solutions/smart-sourcing
- [I19] Purchasing a Smart Sourcing Subscription — https://www.indeed.com/help/employers/articles/360015770072
- [I20] Third-Party Recruiters and Aggregators — https://www.indeed.com/help/employers/articles/360018069792
- [I21] How to Use Indeed Analytics — https://www.indeed.com/hire/resources/howtohub/insights-from-your-indeed-performance-reports
- [I22] Creating an Indeed Hiring Event — https://ca.indeed.com/help/employers/articles/how-to-use-the-indeed-hiring-events

Notes on the Indeed column:

- Only features described on these pages are marked ✓. "Share a job",
  "online now" and a referral program were not found in Indeed's help
  pages, so they are marked "–". That means they were not found, not that
  Indeed lacks them.
- Indeed's scheduling help article [I11] describes an employer-picked
  time, candidate confirmation, an .ics file, text reminders and a video
  link. It does not describe calendar free/busy, so that row is marked
  "–". Indeed search filters were not checked against a primary source,
  so that row says "not checked".

## 18. Skipped on purpose

- **Job fairs and hiring events with candidate sign-up.** HOTS has only
  announced these for 2027. OxSteed already has paid hiring events with
  slots (flag `CAREERS_BILLING_ENABLED`). A candidate-facing event page
  needs product and legal decisions (in-person safety, capacity), so it
  was not built here.
- **The ~40k imported listings and scraping.** Importing other sites'
  postings needs licensing or feed agreements. It would mix unverified
  employers into a marketplace whose value is verified employers, and
  scraping breaks the sources' terms. Not built.
- **Paid candidate services** (résumé writing, coaching), paid banner ads
  and ATS integrations. HOTS has announced these but they are not live.

## 19. Launch checklist (ops and legal)

1. **Stripe plans.**
   - Create the Starter, Growth and Pro recurring prices and set
     `CAREERS_STRIPE_PRICE_PLAN_*`.
   - Add the subscription events (`checkout.session.completed`,
     `customer.subscription.*`, `invoice.paid`, `charge.refunded`) to the
     existing `/api/careers/webhooks/stripe` endpoint.
   - Approve the pricing, trial and auto-renewal terms, including state
     auto-renewal disclosures.
   - Then set `CAREERS_PLANS_ENABLED=true`.
2. **Referrals.** Approve the program terms and the tax handling for
   payouts (W-9/1099 where needed). Agree the manual payout process. Then
   set `CAREERS_REFERRALS_ENABLED=true`.
3. **Google Calendar.**
   - Create an OAuth client with the `https://www.googleapis.com/auth/calendar.freebusy`
     scope and register the redirect URI
     `<CAREERS_OAUTH_CALLBACK_BASE>/api/careers/calendar/google/callback`.
   - Complete consent-screen verification for the scope.
   - Set the client id and secret, then `CAREERS_CALENDAR_GOOGLE_ENABLED=true`.
4. **Microsoft 365.**
   - Create an Entra app registration with the delegated `Calendars.ReadBasic`,
     `User.Read` and `offline_access` permissions, and register the redirect URI
     `…/api/careers/calendar/microsoft/callback`.
   - Set the client id, secret and tenant, then
     `CAREERS_CALENDAR_MICROSOFT_ENABLED=true`.
5. **Video room.**
   - Run a TURN server (for example coturn) and set
     `CAREERS_WEBRTC_ICE_SERVERS`.
   - Review the privacy notice: peer to peer, not recorded.
   - Then set `CAREERS_VIDEO_ROOM_ENABLED=true`.
6. **SMS.**
   - Confirm the Twilio account and the 10DLC/toll-free registration for
     the Careers use case.
   - Have counsel review the consent copy (TCPA).
   - Then set `CAREERS_SMS_ENABLED=true`.
7. **AI résumé parsing and AI match.**
   - Pin the Ollama models and digests: `CAREERS_OLLAMA_MODEL`/`_DIGEST`
     for parsing, `CAREERS_OLLAMA_RANK_MODEL`/`_DIGEST` for matching.
   - For AI match, complete everything the AI ranking gate needs (bias
     audit per market, NYC notice period, EU/UK sign-offs).
   - Then set the flags.
8. **Reviews, Q&A and salaries.**
   - Review the moderation policy and the response times for reported
     content.
   - Confirm the anonymity approach with counsel: no names; minimum of 5
     reports for salaries.
   - Check Section 230 / DSA notice-and-action handling for the EU.
