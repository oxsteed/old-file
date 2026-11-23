# Persona roadmap — Groups 7-8: Property manager (301-350), Restaurant owner/manager (351-400), Restaurant team member (401-450)

Branch `feat/persona-group4-rest`, PR #809. Surveyed 2026-11-23 at 2b803fcef. Industry references: Buildium/AppFolio (property), Toast/7shifts (restaurant).

Status: EXISTS = shipped before this batch (evidence given); PARTIAL = extended here; BUILD = new here. `done` marks landed work.

| # | Item | Status | Slice / evidence | State |
|---|---|---|---|---|
| 301 | Portfolio dashboard | BUILD | P-A portfolio | todo |
| 302 | Property profile | PARTIAL | P-A portfolio — `properties` has label/address only; extend with type, owner, budget, archive | todo |
| 303 | Unit directory | PARTIAL | P-A portfolio — `property_portfolio_units` keyed by text label; link to `property_id` | todo |
| 304 | Common area directory | BUILD | P-A portfolio | todo |
| 305 | Archived property history | BUILD | P-A portfolio | todo |
| 306 | Property manager invite | BUILD | P-B assignments | todo |
| 307 | Building staff permissions | BUILD | P-B assignments | todo |
| 308 | Temporary property coverage | BUILD | P-B assignments | todo |
| 309 | Unit-only service contact | BUILD | P-B assignments | todo |
| 310 | Property access review | BUILD | P-B assignments | todo |
| 311 | Occupant request intake | EXISTS | public intake `POST /api/maintenance-requests` (routes/maintenanceRequests.js) | verified |
| 312 | Issue categorization | EXISTS | `property_maintenance_requests.issue_category` | verified |
| 313 | Photo intake | EXISTS | `photo_urls` on intake | verified |
| 314 | Duplicate request linking | BUILD | P-C intake | todo |
| 315 | Urgency triage | EXISTS | `urgency` emergency/urgent/normal/low + `sla_target_at` + workflow_stage triage | verified |
| 316 | Spending approval thresholds | BUILD | P-D approvals/vendors/work orders | todo |
| 317 | Owner approval inbox | BUILD | P-D approvals/vendors/work orders | todo |
| 318 | Multi-quote comparison | BUILD | P-D approvals/vendors/work orders | todo |
| 319 | Approved vendor directory | BUILD | P-D approvals/vendors/work orders | todo |
| 320 | Work order issuance | BUILD | P-D approvals/vendors/work orders | todo |
| 321 | Entry consent record | BUILD | P-E entry | todo |
| 322 | Occupant notification | BUILD | P-E entry | todo |
| 323 | Access window selection | BUILD | P-E entry | todo |
| 324 | Key handover tracking | BUILD | P-E entry | todo |
| 325 | Visit instruction expiry | BUILD | P-E entry | todo |
| 326 | Inspection calendar | PARTIAL | P-F prevention — `property_compliance_records.due_date`; add calendar across schedules | todo |
| 327 | Equipment service schedule | BUILD | P-F prevention | todo |
| 328 | Seasonal task schedule | BUILD | P-F prevention | todo |
| 329 | Recurring vendor bookings | BUILD | P-F prevention | todo |
| 330 | Missed maintenance alerts | BUILD | P-F prevention | todo |
| 331 | Move-out inspections | BUILD | P-G turnover | todo |
| 332 | Cleaning sequence | BUILD | P-G turnover | todo |
| 333 | Repair coordination | BUILD | P-G turnover | todo |
| 334 | Key return checklist | BUILD | P-G turnover | todo |
| 335 | Move-in readiness board | BUILD | P-G turnover | todo |
| 336 | Property cost summary | BUILD | P-H costs | todo |
| 337 | Unit spending report | BUILD | P-H costs | todo |
| 338 | Budget variance alert | BUILD | P-H costs | todo |
| 339 | Vendor invoice matching | BUILD | P-H costs | todo |
| 340 | Maintenance reserve targets | BUILD | P-H costs | todo |
| 341 | Emergency repair routing | BUILD | P-I incidents | todo |
| 342 | Temporary relocation note | BUILD | P-I incidents | todo |
| 343 | Follow-up inspection | BUILD | P-I incidents | todo |
| 344 | Case evidence folder | BUILD | P-I incidents | todo |
| 345 | Owner incident summary | BUILD | P-I incidents | todo |
| 346 | Portfolio handover export | BUILD | P-J transfer | todo |
| 347 | Property reassignment | BUILD | P-J transfer | todo |
| 348 | Vendor contact handoff | BUILD | P-J transfer | todo |
| 349 | Occupant notification update | BUILD | P-J transfer | todo |
| 350 | Property access revocation | BUILD | P-J transfer | todo |
| 351 | Restaurant application | EXISTS | `POST /api/food/restaurants` + setup-progress + publishing | verified |
| 352 | Ownership confirmation | EXISTS | business ownership via `business.own` access request and listing claims (D-195) | verified |
| 353 | Location setup wizard | BUILD | R-A location readiness/template | todo |
| 354 | Launch readiness view | BUILD | R-A location readiness/template | todo |
| 355 | Operating region settings | EXISTS | `/hq/regions` (restaurantHQController) | verified |
| 356 | Menu import | BUILD | R-B menu import/schedule/history | todo |
| 357 | Location price overrides | EXISTS | `restaurant_store_menu_overrides.price_cents` via `PATCH /locations/:id/menu-items/:itemId` | verified |
| 358 | Effective date scheduling | BUILD | R-B menu import/schedule/history | todo |
| 359 | Item availability policy | EXISTS | `availability_schedule`, manual/inventory availability, `available_again_at` | verified |
| 360 | Menu change history | BUILD | R-B menu import/schedule/history | todo |
| 361 | Location invitations | EXISTS | `/location-access` memberships + business invites | verified |
| 362 | Restaurant role templates | EXISTS | business team role templates (`/api/business-team/.../role-templates`) | verified |
| 363 | Cross-location shift assignment | EXISTS | `/labor-borrows` cross-store borrowing | verified |
| 364 | Reassignment review | EXISTS | `/labor-borrows/:id/approve|decline` | verified |
| 365 | Membership termination | EXISTS | member revoke + offboarding (`businessMembersController`) | verified |
| 366 | Prep time configuration | EXISTS | `food_restaurants.prep_time_min`, location `prep_time_extension_min`, auto-extend | verified |
| 367 | Order throttling | EXISTS | location `online_order_pacing_max_per_15_min` / in-store pacing | verified |
| 368 | Temporary closure | EXISTS | `temporarily_closed_until`, `online_order_pause_reason` | verified |
| 369 | Holiday hours | BUILD | R-C hours/slots/pickup/substitution | todo |
| 370 | Pickup slot quotas | BUILD | R-C hours/slots/pickup/substitution | todo |
| 371 | Multi-location order overview | EXISTS | `/operations/stores` | verified |
| 372 | Unclaimed pickup alert | BUILD | R-D ops reports | todo |
| 373 | Order exception dashboard | EXISTS | `/reports/exceptions` | verified |
| 374 | Substitution policy | BUILD | R-C hours/slots/pickup/substitution | todo |
| 375 | Cancellation follow-up | BUILD | R-D ops reports | todo |
| 376 | Delivery eligibility settings | EXISTS | `delivery_radius_meters`, `minimum_order_cents`, `delivery_fee_cents` | verified |
| 377 | Pickup area configuration | BUILD | R-C hours/slots/pickup/substitution | todo |
| 378 | Driver escalation channel | EXISTS | `/runner/contact-rules`, `/runner/tasks/:id/issues` | verified |
| 379 | Dispatch delay report | BUILD | R-D ops reports | todo |
| 380 | Proof of handoff view | EXISTS | `/runner/tasks/:id/proofs` | verified |
| 381 | Location statement view | EXISTS | `/reports/sales/locations` (+csv/xlsx) | verified |
| 382 | Payout draft review | EXISTS | `/pay-runs` draft + finalize | verified |
| 383 | Payout status tracker | EXISTS | `/pay-runs/:id` disbursements status | verified |
| 384 | Adjustment reconciliation | EXISTS | `/accounting/exports/:id/reconcile`, gift-card + credit reconciliation | verified |
| 385 | Refund approval request | EXISTS | `/pos/orders/:id/refunds` with `refunds.approve`, support case refund approval | verified |
| 386 | Prep time trends | BUILD | R-D ops reports | todo |
| 387 | Item unavailability report | BUILD | R-D ops reports | todo |
| 388 | Peak load comparison | BUILD | R-D ops reports | todo |
| 389 | Repeat issue dashboard | BUILD | R-D ops reports | todo |
| 390 | Location quality review | EXISTS | `/audits/runs/:id/score`, brand `/store-comparison` | verified |
| 391 | Equipment downtime notice | BUILD | R-E disruptions | todo |
| 392 | Location order transfer review | BUILD | R-E disruptions | todo |
| 393 | Emergency closure workflow | BUILD | R-E disruptions | todo |
| 394 | Open order cleanup | BUILD | R-E disruptions | todo |
| 395 | Reopening checklist | BUILD | R-E disruptions | todo |
| 396 | New location checklist | BUILD | R-A location readiness/template | todo |
| 397 | Location settings template | BUILD | R-A location readiness/template | todo |
| 398 | Staff capacity forecast | BUILD | R-D ops reports | todo |
| 399 | Menu launch preview | EXISTS | `/hq/menu/preview`, brand menu rollouts | verified |
| 400 | Cross-location reporting | EXISTS | `/reports/sales/locations`, `/hq/rollup` | verified |
| 401 | Location confirmation | BUILD | T-A shift start | todo |
| 402 | Shift task list | BUILD | T-A shift start | todo |
| 403 | Kitchen station assignment | BUILD | T-A shift start | todo |
| 404 | Unread handoff summary | BUILD | T-A shift start | todo |
| 405 | Readiness acknowledgment | BUILD | T-A shift start | todo |
| 406 | Kitchen ticket board | EXISTS | `/kitchen/feed` + FoodKitchenPage | verified |
| 407 | Prep sequence view | EXISTS | courses + `kitchen_fire_mode` | verified |
| 408 | Modifier display | EXISTS | modifiers rendered on KDS tickets | verified |
| 409 | Batch print view | PARTIAL | T-B stations/tickets — `/kitchen/printer-jobs` single order; add batch enqueue | todo |
| 410 | Ready status update | EXISTS | `/kitchen/orders/:id/action` (ready/bump) | verified |
| 411 | Mark item sold out | EXISTS | `/pos/menu-items/:id/sold-out` | verified |
| 412 | Restore availability | EXISTS | `/menu-items/:id/availability` | verified |
| 413 | Flag low stock | BUILD | T-C stock notices | todo |
| 414 | Record substitution options | BUILD | T-C stock notices | todo |
| 415 | Request menu correction | BUILD | T-C stock notices | todo |
| 416 | Package label | BUILD | T-D pickup | todo |
| 417 | Pickup code confirmation | BUILD | T-D pickup | todo |
| 418 | Driver arrival list | BUILD | T-D pickup | todo |
| 419 | Customer pickup confirmation | EXISTS | `handed_off_at` / `handed_off_by` on kitchen handoff | verified |
| 420 | Handoff timestamp | EXISTS | `handed_off_at` stamped on handoff | verified |
| 421 | Missing-item report | BUILD | T-E order issues | todo |
| 422 | Substitution request | BUILD | T-E order issues | todo |
| 423 | Late-order alert | BUILD | T-E order issues | todo |
| 424 | Wrong-order escalation | BUILD | T-E order issues | todo |
| 425 | Customer confirmation tracking | BUILD | T-E order issues | todo |
| 426 | Large text tickets | BUILD | T-F KDS accessibility | todo |
| 427 | Keyboard ticket controls | BUILD | T-F KDS accessibility | todo |
| 428 | Non-color status cues | PARTIAL | T-F KDS accessibility — KDS columns titled; add text status badges on every ticket | todo |
| 429 | Reduced motion mode | BUILD | T-F KDS accessibility | todo |
| 430 | Localized kitchen labels | EXISTS | KDS copy via i18n `food.kds.*` in 20 locales | verified |
| 431 | Station queue filter | BUILD | T-B stations/tickets | todo |
| 432 | Ticket reassignment | BUILD | T-B stations/tickets | todo |
| 433 | Special preparation notes | EXISTS | `food_order_items.special_instructions` + `kitchen_notes` | verified |
| 434 | Prep handoff record | BUILD | T-B stations/tickets | todo |
| 435 | Shared order checklist | BUILD | T-B stations/tickets | todo |
| 436 | Coverage request | EXISTS | shift coverage requests (item 277, business_staff_shifts) | verified |
| 437 | Active ticket transfer | BUILD | T-B stations/tickets | todo |
| 438 | Break return summary | BUILD | T-B stations/tickets | todo |
| 439 | Shift swap notification | EXISTS | shift swap notifications (item 278) | verified |
| 440 | Station reopening check | BUILD | T-B stations/tickets | todo |
| 441 | Food service issue intake | PARTIAL | T-G incidents — `/help-requests` exists; add category food_service, owner, follow-up | todo |
| 442 | Equipment incident note | BUILD | T-G incidents | todo |
| 443 | Location safety notice | EXISTS | `/announcements` + acknowledge | verified |
| 444 | Escalation owner display | BUILD | T-G incidents | todo |
| 445 | Case follow-up | BUILD | T-G incidents | todo |
| 446 | Unresolved order handoff | BUILD | T-H end shift | todo |
| 447 | Pickup exceptions summary | BUILD | T-H end shift | todo |
| 448 | Stock notice handoff | BUILD | T-C stock notices | todo |
| 449 | Shift completion confirmation | BUILD | T-H end shift | todo |
| 450 | Access change recovery | BUILD | T-H end shift | todo |

## Slices

Property (P-A..P-J): one migration `20261123200000_property_manager_ops.sql`, `services/propertyManager/*`, routes `routes/propertyManager.js` at `/api/property-manager/:businessId`.
Restaurant owner (R-A..R-E) and team (T-A..T-H): migration `20261123210000_restaurant_persona_ops.sql`, `services/restaurantPersona/*`, routes appended to `routes/restaurants.js`.

## Next step

Build P-A..P-J, then R-*, then T-*; client panels + 20-locale copy; decisions D-240+.
