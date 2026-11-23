# Persona roadmap — Groups 7-8: Property manager (301-350), Restaurant owner/manager (351-400), Restaurant team member (401-450)

Branch `feat/persona-group4-rest`, PR #809. Surveyed 2026-11-23 at 2b803fcef. Industry references: Buildium/AppFolio (property), Toast/7shifts (restaurant).

Status: EXISTS = shipped before this batch (evidence given); PARTIAL = extended here; BUILD = new here. `done` marks landed work.

| # | Item | Status | Slice / evidence | State |
|---|---|---|---|---|
| 301 | Portfolio dashboard | BUILD | P-A portfolio | server done; UI pending |
| 302 | Property profile | PARTIAL | P-A portfolio — `properties` has label/address only; extend with type, owner, budget, archive | server done; UI pending |
| 303 | Unit directory | PARTIAL | P-A portfolio — `property_portfolio_units` keyed by text label; link to `property_id` | server done; UI pending |
| 304 | Common area directory | BUILD | P-A portfolio | server done; UI pending |
| 305 | Archived property history | BUILD | P-A portfolio | server done; UI pending |
| 306 | Property manager invite | BUILD | P-B assignments | server done; UI pending |
| 307 | Building staff permissions | BUILD | P-B assignments | server done; UI pending |
| 308 | Temporary property coverage | BUILD | P-B assignments | server done; UI pending |
| 309 | Unit-only service contact | BUILD | P-B assignments | server done; UI pending |
| 310 | Property access review | BUILD | P-B assignments | server done; UI pending |
| 311 | Occupant request intake | EXISTS | public intake `POST /api/maintenance-requests` (routes/maintenanceRequests.js) | verified |
| 312 | Issue categorization | EXISTS | `property_maintenance_requests.issue_category` | verified |
| 313 | Photo intake | EXISTS | `photo_urls` on intake | verified |
| 314 | Duplicate request linking | BUILD | P-C intake | server done; UI pending |
| 315 | Urgency triage | EXISTS | `urgency` emergency/urgent/normal/low + `sla_target_at` + workflow_stage triage | verified |
| 316 | Spending approval thresholds | BUILD | P-D approvals/vendors/work orders | server done; UI pending |
| 317 | Owner approval inbox | BUILD | P-D approvals/vendors/work orders | server done; UI pending |
| 318 | Multi-quote comparison | BUILD | P-D approvals/vendors/work orders | server done; UI pending |
| 319 | Approved vendor directory | BUILD | P-D approvals/vendors/work orders | server done; UI pending |
| 320 | Work order issuance | BUILD | P-D approvals/vendors/work orders | server done; UI pending |
| 321 | Entry consent record | BUILD | P-E entry | server done; UI pending |
| 322 | Occupant notification | BUILD | P-E entry | server done; UI pending |
| 323 | Access window selection | BUILD | P-E entry | server done; UI pending |
| 324 | Key handover tracking | BUILD | P-E entry | server done; UI pending |
| 325 | Visit instruction expiry | BUILD | P-E entry | server done; UI pending |
| 326 | Inspection calendar | PARTIAL | P-F prevention — `property_compliance_records.due_date`; add calendar across schedules | server done; UI pending |
| 327 | Equipment service schedule | BUILD | P-F prevention | server done; UI pending |
| 328 | Seasonal task schedule | BUILD | P-F prevention | server done; UI pending |
| 329 | Recurring vendor bookings | BUILD | P-F prevention | server done; UI pending |
| 330 | Missed maintenance alerts | BUILD | P-F prevention | server done; UI pending |
| 331 | Move-out inspections | BUILD | P-G turnover | server done; UI pending |
| 332 | Cleaning sequence | BUILD | P-G turnover | server done; UI pending |
| 333 | Repair coordination | BUILD | P-G turnover | server done; UI pending |
| 334 | Key return checklist | BUILD | P-G turnover | server done; UI pending |
| 335 | Move-in readiness board | BUILD | P-G turnover | server done; UI pending |
| 336 | Property cost summary | BUILD | P-H costs | server done; UI pending |
| 337 | Unit spending report | BUILD | P-H costs | server done; UI pending |
| 338 | Budget variance alert | BUILD | P-H costs | server done; UI pending |
| 339 | Vendor invoice matching | BUILD | P-H costs | server done; UI pending |
| 340 | Maintenance reserve targets | BUILD | P-H costs | server done; UI pending |
| 341 | Emergency repair routing | BUILD | P-I incidents | server done; UI pending |
| 342 | Temporary relocation note | BUILD | P-I incidents | server done; UI pending |
| 343 | Follow-up inspection | BUILD | P-I incidents | server done; UI pending |
| 344 | Case evidence folder | BUILD | P-I incidents | server done; UI pending |
| 345 | Owner incident summary | BUILD | P-I incidents | server done; UI pending |
| 346 | Portfolio handover export | BUILD | P-J transfer | server done; UI pending |
| 347 | Property reassignment | BUILD | P-J transfer | server done; UI pending |
| 348 | Vendor contact handoff | BUILD | P-J transfer | server done; UI pending |
| 349 | Occupant notification update | BUILD | P-J transfer | server done; UI pending |
| 350 | Property access revocation | BUILD | P-J transfer | server done; UI pending |
| 351 | Restaurant application | EXISTS | `POST /api/food/restaurants` + setup-progress + publishing | verified |
| 352 | Ownership confirmation | EXISTS | business ownership via `business.own` access request and listing claims (D-195) | verified |
| 353 | Location setup wizard | BUILD | R-A location readiness/template | server done; UI pending |
| 354 | Launch readiness view | BUILD | R-A location readiness/template | server done; UI pending |
| 355 | Operating region settings | EXISTS | `/hq/regions` (restaurantHQController) | verified |
| 356 | Menu import | BUILD | R-B menu import/schedule/history | server done; UI pending |
| 357 | Location price overrides | EXISTS | `restaurant_store_menu_overrides.price_cents` via `PATCH /locations/:id/menu-items/:itemId` | verified |
| 358 | Effective date scheduling | BUILD | R-B menu import/schedule/history | server done; UI pending |
| 359 | Item availability policy | EXISTS | `availability_schedule`, manual/inventory availability, `available_again_at` | verified |
| 360 | Menu change history | BUILD | R-B menu import/schedule/history | server done; UI pending |
| 361 | Location invitations | EXISTS | `/location-access` memberships + business invites | verified |
| 362 | Restaurant role templates | EXISTS | business team role templates (`/api/business-team/.../role-templates`) | verified |
| 363 | Cross-location shift assignment | EXISTS | `/labor-borrows` cross-store borrowing | verified |
| 364 | Reassignment review | EXISTS | `/labor-borrows/:id/approve|decline` | verified |
| 365 | Membership termination | EXISTS | member revoke + offboarding (`businessMembersController`) | verified |
| 366 | Prep time configuration | EXISTS | `food_restaurants.prep_time_min`, location `prep_time_extension_min`, auto-extend | verified |
| 367 | Order throttling | EXISTS | location `online_order_pacing_max_per_15_min` / in-store pacing | verified |
| 368 | Temporary closure | EXISTS | `temporarily_closed_until`, `online_order_pause_reason` | verified |
| 369 | Holiday hours | BUILD | R-C hours/slots/pickup/substitution | server done; UI pending |
| 370 | Pickup slot quotas | BUILD | R-C hours/slots/pickup/substitution | server done; UI pending |
| 371 | Multi-location order overview | EXISTS | `/operations/stores` | verified |
| 372 | Unclaimed pickup alert | BUILD | R-D ops reports | server done; UI pending |
| 373 | Order exception dashboard | EXISTS | `/reports/exceptions` | verified |
| 374 | Substitution policy | BUILD | R-C hours/slots/pickup/substitution | server done; UI pending |
| 375 | Cancellation follow-up | BUILD | R-D ops reports | server done; UI pending |
| 376 | Delivery eligibility settings | EXISTS | `delivery_radius_meters`, `minimum_order_cents`, `delivery_fee_cents` | verified |
| 377 | Pickup area configuration | BUILD | R-C hours/slots/pickup/substitution | server done; UI pending |
| 378 | Driver escalation channel | EXISTS | `/runner/contact-rules`, `/runner/tasks/:id/issues` | verified |
| 379 | Dispatch delay report | BUILD | R-D ops reports | server done; UI pending |
| 380 | Proof of handoff view | EXISTS | `/runner/tasks/:id/proofs` | verified |
| 381 | Location statement view | EXISTS | `/reports/sales/locations` (+csv/xlsx) | verified |
| 382 | Payout draft review | EXISTS | `/pay-runs` draft + finalize | verified |
| 383 | Payout status tracker | EXISTS | `/pay-runs/:id` disbursements status | verified |
| 384 | Adjustment reconciliation | EXISTS | `/accounting/exports/:id/reconcile`, gift-card + credit reconciliation | verified |
| 385 | Refund approval request | EXISTS | `/pos/orders/:id/refunds` with `refunds.approve`, support case refund approval | verified |
| 386 | Prep time trends | BUILD | R-D ops reports | server done; UI pending |
| 387 | Item unavailability report | BUILD | R-D ops reports | server done; UI pending |
| 388 | Peak load comparison | BUILD | R-D ops reports | server done; UI pending |
| 389 | Repeat issue dashboard | BUILD | R-D ops reports | server done; UI pending |
| 390 | Location quality review | EXISTS | `/audits/runs/:id/score`, brand `/store-comparison` | verified |
| 391 | Equipment downtime notice | BUILD | R-E disruptions | server done; UI pending |
| 392 | Location order transfer review | BUILD | R-E disruptions | server done; UI pending |
| 393 | Emergency closure workflow | BUILD | R-E disruptions | server done; UI pending |
| 394 | Open order cleanup | BUILD | R-E disruptions | server done; UI pending |
| 395 | Reopening checklist | BUILD | R-E disruptions | server done; UI pending |
| 396 | New location checklist | BUILD | R-A location readiness/template | server done; UI pending |
| 397 | Location settings template | BUILD | R-A location readiness/template | server done; UI pending |
| 398 | Staff capacity forecast | BUILD | R-D ops reports | server done; UI pending |
| 399 | Menu launch preview | EXISTS | `/hq/menu/preview`, brand menu rollouts | verified |
| 400 | Cross-location reporting | EXISTS | `/reports/sales/locations`, `/hq/rollup` | verified |
| 401 | Location confirmation | BUILD | T-A shift start | server done; UI pending |
| 402 | Shift task list | BUILD | T-A shift start | server done; UI pending |
| 403 | Kitchen station assignment | BUILD | T-A shift start | server done; UI pending |
| 404 | Unread handoff summary | BUILD | T-A shift start | server done; UI pending |
| 405 | Readiness acknowledgment | BUILD | T-A shift start | server done; UI pending |
| 406 | Kitchen ticket board | EXISTS | `/kitchen/feed` + FoodKitchenPage | verified |
| 407 | Prep sequence view | EXISTS | courses + `kitchen_fire_mode` | verified |
| 408 | Modifier display | EXISTS | modifiers rendered on KDS tickets | verified |
| 409 | Batch print view | PARTIAL | T-B stations/tickets — `/kitchen/printer-jobs` single order; add batch enqueue | server done; UI pending |
| 410 | Ready status update | EXISTS | `/kitchen/orders/:id/action` (ready/bump) | verified |
| 411 | Mark item sold out | EXISTS | `/pos/menu-items/:id/sold-out` | verified |
| 412 | Restore availability | EXISTS | `/menu-items/:id/availability` | verified |
| 413 | Flag low stock | BUILD | T-C stock notices | server done; UI pending |
| 414 | Record substitution options | BUILD | T-C stock notices | server done; UI pending |
| 415 | Request menu correction | BUILD | T-C stock notices | server done; UI pending |
| 416 | Package label | BUILD | T-D pickup | server done; UI pending |
| 417 | Pickup code confirmation | BUILD | T-D pickup | server done; UI pending |
| 418 | Driver arrival list | BUILD | T-D pickup | server done; UI pending |
| 419 | Customer pickup confirmation | EXISTS | `handed_off_at` / `handed_off_by` on kitchen handoff | verified |
| 420 | Handoff timestamp | EXISTS | `handed_off_at` stamped on handoff | verified |
| 421 | Missing-item report | BUILD | T-E order issues | server done; UI pending |
| 422 | Substitution request | BUILD | T-E order issues | server done; UI pending |
| 423 | Late-order alert | BUILD | T-E order issues | server done; UI pending |
| 424 | Wrong-order escalation | BUILD | T-E order issues | server done; UI pending |
| 425 | Customer confirmation tracking | BUILD | T-E order issues | server done; UI pending |
| 426 | Large text tickets | BUILD | T-F KDS accessibility | todo (client-only KDS prefs) |
| 427 | Keyboard ticket controls | BUILD | T-F KDS accessibility | todo (client-only KDS prefs) |
| 428 | Non-color status cues | PARTIAL | T-F KDS accessibility — KDS columns titled; add text status badges on every ticket | todo (client-only KDS prefs) |
| 429 | Reduced motion mode | BUILD | T-F KDS accessibility | todo (client-only KDS prefs) |
| 430 | Localized kitchen labels | EXISTS | KDS copy via i18n `food.kds.*` in 20 locales | verified |
| 431 | Station queue filter | BUILD | T-B stations/tickets | server done; UI pending |
| 432 | Ticket reassignment | BUILD | T-B stations/tickets | server done; UI pending |
| 433 | Special preparation notes | EXISTS | `food_order_items.special_instructions` + `kitchen_notes` | verified |
| 434 | Prep handoff record | BUILD | T-B stations/tickets | server done; UI pending |
| 435 | Shared order checklist | BUILD | T-B stations/tickets | server done; UI pending |
| 436 | Coverage request | EXISTS | shift coverage requests (item 277, business_staff_shifts) | verified |
| 437 | Active ticket transfer | BUILD | T-B stations/tickets | server done; UI pending |
| 438 | Break return summary | BUILD | T-B stations/tickets | server done; UI pending |
| 439 | Shift swap notification | EXISTS | shift swap notifications (item 278) | verified |
| 440 | Station reopening check | BUILD | T-B stations/tickets | server done; UI pending |
| 441 | Food service issue intake | PARTIAL | T-G incidents — `/help-requests` exists; add category food_service, owner, follow-up | server done; UI pending |
| 442 | Equipment incident note | BUILD | T-G incidents | server done; UI pending |
| 443 | Location safety notice | EXISTS | `/announcements` + acknowledge | verified |
| 444 | Escalation owner display | BUILD | T-G incidents | server done; UI pending |
| 445 | Case follow-up | BUILD | T-G incidents | server done; UI pending |
| 446 | Unresolved order handoff | BUILD | T-H end shift | server done; UI pending |
| 447 | Pickup exceptions summary | BUILD | T-H end shift | server done; UI pending |
| 448 | Stock notice handoff | BUILD | T-C stock notices | server done; UI pending |
| 449 | Shift completion confirmation | BUILD | T-H end shift | server done; UI pending |
| 450 | Access change recovery | BUILD | T-H end shift | server done; UI pending |

## Slices

Property (P-A..P-J): migration `20261123200000_property_manager_ops.sql`, `server/services/propertyManager/{access,portfolioService,workService,upkeepService}.js`, `server/routes/propertyManager.js` (business: `/api/businesses/:businessId/properties/*`; owner/occupant: `/api/me/property/*`). Test `server/__tests__/group7Property.db.test.js`.
Restaurant (R-A..R-E, T-A..T-H): migration `20261123210000_restaurant_persona_ops.sql`, `server/services/restaurantPersona/{access,ownerService,teamService}.js`, `server/routes/restaurantPersona.js` (`/api/restaurants/:restaurantId/ops/*`, `/shift/*`, `/me/shift-access`, public `/locations/:locationId/pickup-info|pickup-slots`, `POST /my/order-questions/:issueId`). Checkout guard `assertOrderAllowed` called in `controllers/foodController.js`. Test `server/__tests__/group8Restaurant.db.test.js`.
Decisions D-240..D-252 in `persona-roadmap-decisions.md`.

## Next step

Server for 301-450 is done and tested. Remaining, in order (each is independent; commit+push after each):
1. `server/jobs/restaurantScheduledMenuSweeper.js`: copy `jobs/businessAppointmentNoShowSweeper.js` (withFencedJobLock, 60s interval) and call `ownerService.applyDueMenuChanges(pool)` plus `ownerService.alertUnclaimed` per active restaurant; register in `server/bootstrap/backgroundWorkers.js`.
2. Tracked order (customer): add `pickup_code`, pickup info (`ownerService.pickupInfo`) and pending substitution questions (`teamService.pendingQuestions`) to the order tracking payload in `controllers/foodController.js` order-detail handler; answer via existing `POST /api/restaurants/my/order-questions/:issueId`.
3. KDS accessibility 426-429 in `client/src/pages/food/FoodKitchenPage.jsx`: localStorage prefs `kds.a11y` {largeText, reducedMotion}; text status badges on every ticket; keyboard (J/K move, Enter bump, R recall) — copy under `food.kds.a11y.*` in all 20 locales.
4. Client panels: `client/src/components/businessHub/g56/PropertyConsolePanel.jsx` (calls `/api/businesses/:id/properties/*`) and `RestaurantOpsPanel.jsx` / `ShiftPanel.jsx` (calls `/ops/*`, `/shift/*`) using `useBizG56`; copy keys in `docs/persona-roadmap/group5-6-copy.json` then `python3 docs/persona-roadmap/tools/group56-sync.py .`; run `node client/scripts/growthInstrumentation.mjs --write` and `npm run test:locale-shard-loaders`.
5. Mark rows done, update PR #809 body (`/workspace/wt/ui/pr809.md`) and `gh pr checks 809` until green. Do not merge.
