# Logistics workspace count failure

Base: merged PR #595, default branch `d5dc368c`.

The Organizer dashboard's red Data unavailable banner was caused by HTTP 500 from `/api/logistics/dashboard/counts?scope=organizer`. Its SQL compared `delivery_order_status` with `scheduled`, which is not a valid enum member; the persisted state is `assigned`. PostgreSQL rejects this comparison even for an empty workspace. The buyer/distributor count queries also referenced nonexistent `fulfilled` sourcing and `customs_review` shipment states.

The fix uses the existing valid states without changing schema or authorization. The legacy `scheduledDeliveries` response field is retained for compatibility and counts assigned deliveries. Organizer loading waits for the lists and counts, clears stale counts on retry, ignores superseded responses, and renders unavailable values rather than false zeros or an empty next-step panel when counts fail. Distributor fallback counts use the same assigned status.

Validation: 43 tests passed across four server suites, including real migrated PostgreSQL queries for buyer, organizer, distributor, and compliance scopes, assigned/pending/in-transit handoffs, and recipient isolation. The CI integration step now requires all three Logistics database suites without skips. The browser regression passed its existing responsive/workflow matrix plus Organizer count failure and retry recovery. Client `npm run build:ci` passed with 986 emitted assets; `git diff --check` passed.

No new API, migration, production setting, or permission change. Local validation is separate from remote CI and production deployment.
