# Privacy and consent notes: Growth Center (Promote) attribution

Status: implemented on `codex/analytics-decisions` (decisions 1-3, October 19, 2026).
**Needs a privacy-policy check before release** (see the last section).

## What is collected

| Data | Where | Who | Retention |
|---|---|---|---|
| Tracked visit: owner, source, medium, campaign, content, time | `promotion_link_events` (visit) | every visitor arriving through a Growth Center link | 730 days |
| Device key: SHA-256 of (owner, random device id) | `promotion_link_events.actor_key` | every tracked visit | 730 days |
| **Account key: SHA-256 of (owner, account id)** | `promotion_link_events.account_key` | **only signed-in visitors who have NOT accepted analytics cookies** | **cleared after 7 days** (hourly job plus the daily retention job) |
| Conversion: type (booking, appointment, order, job), the visit it is credited to, a hashed reference, and whether it was later cancelled or refunded | `promotion_link_events` (conversion) | conversions credited to a tracked visit | 730 days |

No contact details, IP addresses, user agents, raw account ids or raw reference
ids are stored. Owners only ever see aggregates.

## Device id and consent

- **With analytics consent:** the random device id lives in `localStorage` and
  persists across sessions. Conversions are linked through it within 7 days.
- **Without analytics consent:** the device id lives in `sessionStorage` (per
  tab) and nothing durable is stored on the device. The visit beacon reports
  `analyticsConsent: false`. If the visitor is signed in, the server also
  stores the per-owner account key on that visit. A later booking, appointment,
  order or marketplace hire made **by the same signed-in account within 7 days**
  is credited to that visit, even from another tab or device. After 7 days the
  account key is set to NULL and can no longer link anything.
- A visitor who is not signed in and has not consented is linked only within
  the same tab, as before.
- If an older client sends no consent field, it is treated as non-consent:
  only the 7-day account link applies.
- Admins acting as a user (impersonation) never create conversions.

## Net conversions

Database triggers on `booking_requests`, `business_appointments`, `food_orders`
and `jobs` mark a conversion as reversed when the source row is cancelled or
refunded. The trigger recomputes the hashed reference, so no reference id is
stored for this. The triggers never raise, so analytics cannot block a
cancellation or refund.

## Privacy-policy check needed

The account link is new processing for visitors who **declined** analytics
cookies: a signed-in account is associated with a marketing-link visit for up
to 7 days, for attribution reporting to the profile owner (aggregate only).
Before release, the privacy owner should confirm that the Privacy Policy and
Cookie Policy cover this (for example, under legitimate interest or
service-improvement analytics for signed-in users), or update them. Note that
the Terms and Privacy notice obligation (14 days' email notice for material
changes) may apply. No policy text was changed in this branch.
