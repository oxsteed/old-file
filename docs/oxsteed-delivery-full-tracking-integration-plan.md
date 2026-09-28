# Full OxSteed Delivery Tracking Integration

## Summary

Extend the existing delivery workflow into a complete, source-neutral tracking system covering:

- Driver-phone GPS
- Vehicle telematics
- QR/barcode scans
- Geofences
- ETA calculation
- Realtime customer updates
- Secure tracking links
- Operations monitoring
- Delivery history, support, and audit records

The existing delivery state machine, pricing, payments, proof-of-delivery, authorization, realtime sockets, and `/logistics` separation remain authoritative.

The current start-of-route ETA becomes one input to a continuously refreshed tracking service.

## Tracking foundation

Additive tracking records are required for:

- Registered driver devices and vehicle trackers
- Driver/vehicle-to-delivery assignments
- Location points with source, accuracy, timestamp, sequence, and validation state
- Normalized tracking events and provider delivery receipts
- QR/barcode scan events
- Geofence definitions and arrival/departure observations
- ETA snapshots and freshness metadata
- Customer tracking-link tokens
- Provider connections, cursors, webhook subscriptions, and sync errors
- Tracking consent, retention, and revocation records

Create one provider-neutral adapter contract supporting:

- Driver-phone GPS
- Geotab
- Samsara
- Motive
- Verizon Connect
- Future telematics providers through the same normalized interface

Provider credentials and webhook secrets must use the existing secure configuration pattern. Provider events must be signature-validated, deduplicated, version-aware, and idempotent.

## Location and event processing

### Driver GPS

Add a mobile-friendly driver tracking control with:

- Explicit consent before tracking starts
- Active tracking only for an assigned delivery
- 15-second location updates while active
- Automatic stop after delivery, cancellation, return, or assignment removal
- Offline buffering with ordered replay after reconnect
- Accuracy, timestamp, speed, and jump validation
- Invalid or suspicious points marked for review instead of changing delivery state

### Telematics

When an assigned vehicle has an active provider tracker:

- Match provider vehicle identity to the OxSteed vehicle record
- Receive signed webhook events and incremental provider updates
- Normalize coordinates, movement, ignition, stop, and arrival signals
- Detect expired subscriptions, revoked access, stale cursors, and provider outages
- Use driver GPS as a fallback only when the configured source policy permits it

### Scans

Support authorized QR/barcode scans for:

- Pickup confirmation
- Handoff or transfer
- Arrival at destination
- Return-to-sender
- Exception evidence

Scans create immutable tracking events and update operational timelines. They cannot mark a delivery complete without the configured proof-of-delivery requirement.

### Geofences

Create pickup and destination geofences from delivery coordinates.

Geofence signals may:

- Suggest arrival or departure
- Trigger customer notifications
- Refresh ETA
- Flag missed or unexpected stops
- Create an operations review item

They must not silently mark a delivery delivered or trigger a financial action.

## State, ETA, and source precedence

The server-owned delivery state machine remains the source of truth:

`posted -> internal review -> assigned -> picked up -> in transit -> delivered`

Marketplace fallback remains source-neutral to customers.

Tracking sources provide evidence and suggestions, but:

- Authorized status actions control committed milestones
- Valid proof is still required for completion
- Tracking never changes the quoted price
- Tracking never creates charges, refunds, or payments
- Tracking never exposes whether fulfillment is internal or marketplace-based to routine customer views

ETA behavior:

- Recalculate from the most trusted available location and route source
- Process location updates at 15-second cadence
- Recalculate ETA no more than once per minute or after meaningful movement
- Show the last updated time and source freshness
- Mark ETA unavailable when routing, location, or provider data cannot be trusted
- Preserve the current route-based estimate as the fallback before live movement begins
- Mark the estimate stale after 15 minutes without a valid update

Customer-facing location must be approximate, using a privacy-preserving radius or road segment of approximately 500 meters. Exact coordinates remain limited to authorized operations users and the assigned driver where operationally necessary.

## API additions

Keep existing delivery endpoints unchanged and add authorized tracking APIs for:

- Starting, renewing, and stopping driver tracking consent
- Submitting batched driver location points
- Retrieving customer-safe tracking state
- Retrieving exact operational tracking state
- Creating, revoking, and refreshing customer tracking links
- Submitting and listing delivery scans
- Registering and managing devices and vehicle trackers
- Connecting, validating, pausing, and disconnecting telematics providers
- Receiving provider webhooks
- Reviewing stale, rejected, duplicated, or suspicious tracking events
- Reconciling provider cursors and replaying failed tracking deliveries
- Reviewing geofence observations and ETA history

Add a signed, expiring public tracking endpoint for recipients without an OxSteed account. It exposes only:

- Delivery reference
- Approximate progress
- Approved milestones
- ETA and freshness
- Masked pickup/drop-off information
- Support contact path

Tracking links expire 24 hours after completion, cancellation, or return and are revoked immediately when manually disabled.

## Realtime and workers

Extend the existing delivery event/outbox system with:

- `location_updated`
- `eta_updated`
- `geofence_arrival`
- `geofence_departure`
- `scan_recorded`
- `tracking_stale`
- `tracking_reconnected`
- `tracking_exception`

Processing requirements:

- Persist tracking events transactionally with related state changes
- Use per-consumer delivery records and idempotency keys
- Deduplicate provider events and mobile retries
- Reject out-of-order updates unless they are valid late-arriving audit events
- Broadcast customer-safe events only to authorized delivery participants
- Broadcast exact operational events only to authorized operations rooms
- Reload authoritative state after socket reconnect
- Keep notifications localized and avoid private coordinates in notification payloads

Add background workers for:

- Location normalization
- ETA refresh
- Geofence evaluation
- Provider webhook retries
- Cursor reconciliation
- Stale tracker detection
- Tracking-link cleanup
- Raw-location retention and summary generation

## Product interfaces

### Customer

Update the delivery detail page with:

- Approximate live progress card or map
- ETA and last-updated timestamp
- Freshness or temporarily unavailable state
- Pickup, handoff, transit, approaching, and delivered milestones
- Secure share-tracking-link action
- Notifications for meaningful movement and delays
- Support and exception actions

Do not display exact driver coordinates, private notes, tracker IDs, or fulfillment source.

### Driver and helper

Add assigned-delivery tracking controls for:

- Consent
- Start/pause tracking
- Permission recovery
- Offline status
- GPS accuracy warnings
- Pickup and handoff scans
- Exception reporting
- Proof-of-delivery submission

Marketplace helpers see only explicitly released work and only their assigned tracking data.

### Operations

Add an operations tracking workspace showing:

- Exact current location where authorized
- Driver, vehicle, tracker, and provider source
- Assignment and tracking health
- Last update and stale duration
- ETA history
- Geofence events
- Scan history
- Invalid or suspicious point reviews
- Provider sync failures
- Tracking-link status
- Audit history and replay controls

## Privacy, authorization, and retention

- Customers can see only their own delivery or possess a valid scoped tracking token.
- Drivers can submit location only for an active assigned delivery.
- Helpers cannot view internal-only tracker information.
- Operations users can view exact location only through the existing protected workspace.
- Provider webhooks cannot grant user access.
- Location data is encrypted in transit and protected at rest through existing storage/database controls.
- Raw location points are retained for 90 days.
- Route summaries, milestone history, and dispute-relevant aggregates are retained for 24 months.
- Tracking stops on completion, cancellation, return, or assignment removal.
- Audit records remain available without exposing raw location history to customers.

## Verification and rollout

Test:

- GPS consent, start, stop, reconnect, and offline replay
- 15-second batching and duplicate suppression
- Telematics provider signatures, cursors, retries, and revoked access
- Multiple provider adapters using the normalized contract
- QR/barcode scan authorization and idempotency
- Geofence arrival/departure thresholds
- ETA refresh, stale state, route-provider fallback, and timezone handling
- Out-of-order and impossible location points
- Internal assignment versus marketplace fallback
- Customer-safe versus operations-exact projections
- Expiring tracking links and revoked links
- Socket reconnect and authoritative state reload
- Delivery completion still requiring valid proof
- No tracking event creating charges, refunds, or delivery completion
- Support, delay, damage, missing shipment, cancellation, and return workflows
- English, Spanish, French, Haitian Creole, Arabic, RTL, mobile, accessibility, light mode, dark mode, and reduced motion

Run:

- `npm run verify:i18n`
- `npm run typecheck`
- `npm run build:ci`
- Existing delivery pricing, state, payment, upload, authorization, notification, and browser suites
- New tracking ingestion, concurrency, provider webhook, geofence, ETA, privacy, and retention suites

Roll out in this order:

1. Apply additive migrations and deploy tracking workers disabled for customer visibility.
2. Enable internal event ingestion and operations monitoring.
3. Enable driver GPS and scan tracking for controlled internal deliveries.
4. Enable telematics adapters and provider reconciliation.
5. Enable approximate customer tracking and signed links.
6. Expand to marketplace deliveries after concurrency, privacy, stale-data, and fallback checks pass.

The release is complete only when a real delivery succeeds through:

`create -> quote -> post -> assignment -> tracking consent -> pickup scan -> GPS/telematics updates -> ETA refresh -> destination arrival -> proof -> delivered -> receipt/payment -> support history`

## Assumptions and defaults

- This covers all selected tracking sources, not only driver GPS.
- Customer visibility is approximate location, not exact GPS.
- Geotab, Samsara, Motive, and Verizon Connect are the initial named telematics adapters.
- Driver GPS updates every 15 seconds during active delivery.
- Raw location is retained for 90 days; summarized routes remain for 24 months.
- The server state machine remains authoritative.
- Geofences and scans can suggest safe milestones but cannot complete delivery without valid proof.
- `/delivery` remains the simple point-to-point product; `/logistics` remains reserved for future freight and procurement workflows.
