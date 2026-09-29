# Direct catalog availability — operator migrate checklist

Canonical detail lives in:

`docs/superpowers/specs/2026-09-29-direct-catalog-availability-long-term.md` → **Operator migrate checklist (per environment)**

Summary per env:

1. Migrate **589** (capacity / holds / Live backfill) + **590** (hold indexes for TTL sweeper).
2. Verify Live⇒operational backfill + `direct_catalog_orphans_report`.
3. Smoke Bookable vs Requestable with **one** assignee (book success, overlapping 409, auto-fall to Request).
4. Confirm hold TTL sweeper: `directSlotHoldExpiry` cron `55 * * * * *` registered in `BackgroundWorkers`; on-demand `expireHolds` remains on slots/hold/book paths. Hold TTL ≈ 4 minutes (`HOLD_TTL_MS`).
5. Tools stay non-Bookable.
