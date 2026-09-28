# Close the OxSteed Delivery Implementation Gaps

## Summary

Complete the existing `/delivery` implementation without replacing authoritative payment, support, messaging, or logistics services. Preserve `/logistics` as the future freight/procurement product.

The work will secure the delivery lifecycle, make internal fulfillment and marketplace fallback mutually exclusive, connect pricing and payments correctly, add recovery workflows, and provide complete customer, driver, helper, and operations experiences.

## Implementation Changes

### 1. Database and workflow integrity

Add an additive migration for:

- Immutable delivery quote records containing amount, inputs, expiration, acceptance time, and pricing version.
- Delivery request idempotency records with request-body fingerprints.
- Proof verification metadata and upload references.
- Driver/vehicle assignment reservations with active time windows.
- Delivery status transitions, reschedule requests, returns, and exception resolution records.
- Extra-charge payment references and approval/capture states.
- Durable delivery events and per-consumer delivery records.

Enforce these invariants transactionally:

- A cancelled, picked-up, in-transit, delivered, or returned delivery cannot be released or reassigned improperly.
- A delivery cannot have simultaneous internal and marketplace ownership.
- One driver or vehicle cannot be assigned to overlapping delivery windows.
- Duplicate request, claim, assignment, release, status, proof, and payment operations are idempotent.
- Quote acceptance uses the original unexpired quote snapshot; posting cannot silently recalculate the customer price.
- Legacy jobs retain valid historical behavior but cannot bypass the new state machine.

### 2. Secure intake, pricing, and access

Strengthen intake validation for:

- Positive pieces, dimensions, weight, declared value, and supported contents.
- Required pickup/drop-off contacts and valid time windows.
- Domestic/local service-area limits.
- Rejection of hazmat, freight, international, customs, warehouse, and unsupported shipments.
- Handling requirements that are explicitly supported by the selected fulfillment option.

Add request idempotency from the browser through the API using `Idempotency-Key` or a generated client request ID.

Return role-specific projections:

- Customers see their delivery, approved customer-visible milestones, masked contacts, receipts, proof status, and support actions.
- Helpers see only explicitly released marketplace work.
- Internal drivers see their assigned deliveries and operational instructions.
- Operations users see routing source, driver data, audit history, and internal exceptions.
- Internal routing source and private operational notes never appear in routine customer responses.

### 3. Fulfillment and dispatch

Implement a guarded state machine covering:

`posted → internal_review → internal_assignment_attempt → internal_assigned → assigned → picked_up → in_transit → delivered`

Fallback path:

`internal_review → marketplace_posted → helper_claimed → assigned → picked_up → in_transit → delivered`

Add:

- Capability matching for payload, dimensions, pieces, fragile/perishable handling, temperature control, equipment, insurance, service area, and availability.
- Driver and vehicle availability reservations.
- Safe assignment and reassignment under row locks/advisory locks.
- Recorded failed internal assignment attempts with reason and actor.
- Operator-entered marketplace release reasons.
- Release checks that reject cancelled, picked-up, in-transit, delivered, returned, or already-owned deliveries.
- Cleanup of old internal/helper assignments before changing fulfillment source.
- Driver workspace listing for assigned jobs and milestone updates.
- Operations UI for driver/vehicle management, assignment history, failed attempts, audit history, and exception handling.

Helpers must not see or claim a delivery until an authorized operator releases it.

### 4. Proof of delivery and exceptions

Require proof matching the delivery’s configured preference:

- PIN: server-generated, securely verified, single-use, and never exposed in logs.
- Signature: actual signed payload or verified uploaded signature.
- Photo: required uploaded media with ownership, type, size, malware, and storage validation.
- Recipient confirmation: explicit recipient name/contact confirmation rather than a client-generated literal string.

Prevent delivery completion without valid proof and prevent duplicate proof submissions.

Add complete workflows for:

- Delay.
- Damage.
- Missing shipment.
- Recipient unavailable.
- Failed delivery.
- Cancellation.
- Rescheduling.
- Return to sender.
- Exception resolution.
- Customer and operations support escalation.

Each workflow must preserve the original delivery history and require the appropriate authorization.

### 5. Extras, payments, receipts, and support

Connect approved extras to existing financial services:

- Waiting.
- Parking/tolls.
- Difficult access.
- Loading help.
- Special handling.

The sequence must be:

`requested → customer approval → authorized payment/charge → receipt`

No extra is captured without customer approval. Approval, capture, refund, and retry operations use idempotency keys and existing payment/ledger services.

Add customer-visible receipts and payment status to the delivery detail page. Link delivery exceptions to existing support records rather than creating a separate support system.

### 6. Events, notifications, ETA, and realtime

Create delivery events transactionally with domain changes, then process notifications asynchronously through the existing outbox/worker infrastructure.

Publish localized updates for:

- Request received.
- Driver assigned.
- Pickup completed.
- In transit.
- Approaching destination.
- Delivered.
- Delayed or exceptional.
- Rescheduled or returned.

Add ETA calculation and refresh behavior using existing route/distance services where available, with a clear unavailable state when routing data cannot be verified.

Update clients through existing realtime infrastructure and reload authoritative delivery state after reconnect so missed events cannot leave stale screens.

### 7. Client experience and localization

Complete:

- Customer delivery history and detail views.
- Real proof-entry/upload controls.
- ETA, timeline, receipts, extras, support, reschedule, cancellation, and return actions.
- Internal driver assigned-job view.
- Helper marketplace-only view.
- Operations dispatch and audit views.
- Loading, empty, error, unavailable, and retry states.
- Keyboard navigation, focus states, ARIA labels, responsive mobile layouts, RTL, light/dark themes, and reduced-motion behavior.
- English, Spanish, French, Haitian Creole, and Arabic coverage, including the currently missing delivery translation key.

Use localized status labels, dates, units, validation errors, and notifications instead of raw database values or hardcoded English.

## Tests and Acceptance Criteria

Add controller, service, migration, and integration tests for:

- Intake validation and unsupported shipment rejection.
- Quote creation, expiration, acceptance, immutable pricing, and retry behavior.
- Idempotent creation, claiming, assignment, release, status updates, proof, extras, and payments.
- Concurrent internal assignment versus marketplace release.
- Concurrent helper claims.
- Driver/vehicle capability and schedule conflicts.
- Unauthorized access and role-specific data projection.
- Masked contact information and hidden fulfillment source.
- Valid and invalid proof for every proof type.
- Exception, cancellation, rescheduling, return, and recovery paths.
- Approved-extra payment capture, refunds, and duplicate webhook handling.
- Notifications, ETA updates, reconnect recovery, receipts, and support linking.
- Identical customer behavior whether fulfillment is internal or marketplace.
- `/delivery` and `/logistics` remaining separate.

Run:

- `npm run verify:i18n`
- `npm run typecheck`
- `npm run build:ci`
- Existing pricing, payment, support, authorization, and browser regression suites.
- New delivery API integration and concurrency suites.
- Browser checks for customer, helper, internal driver, and operations flows across all five languages, RTL, mobile, and both themes.

Deployment is not considered complete until the migration applies cleanly, all delivery suites pass, and the full customer journey succeeds:

`create → quote acceptance → internal review → internal assignment or marketplace release → claim → pickup → transit → proof → delivery → receipt/payment → support`.

## Assumptions and Defaults

- Existing uncommitted delivery changes are preserved and extended; no reset or destructive cleanup is performed.
- Existing payment, messaging, upload, support, notification, and authorization services remain authoritative.
- No new credit or payment ledger is introduced.
- `/logistics` receives no customer-delivery behavior.
- Historical delivery relationships are not backfilled; only new or newly modified actions use the completed workflow model.
- Customer-facing fulfillment remains source-neutral except where legally required disclosures belong in records or receipts.
- The release is not approved while any critical proof, ownership, privacy, payment, idempotency, or concurrency test remains failing.
