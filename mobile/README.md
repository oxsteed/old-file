# OxSteed Mobile

Expo React Native + TypeScript app for building a native iOS/Android companion to the current OxSteed web platform.

## Current Shape

- `mobile/package.json`, `mobile/app.json`, `mobile/App.tsx`, and `mobile/src/**` are the active mobile app surface.
- The app uses Expo, React Navigation bottom tabs, TanStack Query, Zustand, SecureStore, and Expo Notifications.
- Native device-calendar integration uses Expo Calendar for confirmed bookings and appointments.
- The bundle identifiers remain `com.oxsteed.app` for iOS and Android so the App Store / Play Store identity can stay consistent.
- Phase 1 is focused on the logged-in native shell:
  - JWT login against the existing OxSteed API.
  - Two-factor login completion.
  - Password reset request and token-based password reset.
  - Registration for customer and helper accounts.
  - Session hydration with `/api/auth/me`.
  - Token refresh and secure token storage.
  - Customer/helper role switching from Account.
  - Push token registration through `/api/mobile/push-token`.
  - Foreground notification presentation and notification-open listener.
  - Feature flags for tabs that are being built in phases.
- Phase 2 customer core is implemented:
  - Customer dashboard reads the consolidated `/api/mobile/feed` payload.
  - Post Job submits scope, category, location, budget, and optional photo uploads through `/api/jobs`.
  - Helpers tab searches `/api/helpers`, drills into `/api/helpers/:id/profile`, starts conversations, and sends direct booking requests through `/api/bookings`.
  - Messages tab lists `/api/messages/conversations`, renders threads, sends optimistic messages, and uploads image attachments.
  - Plans tab lists and creates `/api/planned-needs` records and prepares job-draft conversion context.
  - Payments tab surfaces `/api/invoices` records, creates mobile invoice PaymentIntents through `/api/mobile/invoices/:id/payment-intent`, opens Stripe PaymentSheet, and confirms invoice payment through `/api/mobile/invoices/:id/confirm-payment`.
- Phase 3 helper core is implemented:
  - Helper work center uses native Overview, Jobs, Calendar, Profile, and Earnings sections inside the Helper tab.
  - Overview shows incoming bookings, unread messages, pending bid status, confirmed appointments, and this-week captured earnings.
  - Job Feed searches and filters `/api/jobs`, then submits bids through `/api/bids` with quote amount, availability note, and estimated hours.
  - Calendar lists incoming booking requests from `/api/bookings/incoming`, accepts/declines them, reads helper appointments, and creates unavailable blocks through `/api/calendar/availability`.
  - Profile management reads and writes `/api/helper-profile/me`, `/api/helper-profile/core`, `/api/helper-profile/services`, `/api/helper-profile/policies`, uploads native gallery photos through `/api/mobile/helper/gallery`, and shows the public profile QR/link target.
  - Earnings reads `/api/payments/me?role=payee`, shows Stripe Connect readiness from `/api/payments/connect/status`, and launches onboarding through `/api/payments/connect`.
- Phase 4 scheduling and direct booking is implemented:
  - Helper profile booking fetches live availability slots from `/api/bookings/helper/:helperId/available-slots`.
  - Customers can request a direct booking from a selected slot and optionally pay a deposit or full amount through Stripe PaymentSheet.
  - Accepted bookings and appointments can be added to the device calendar.
  - Customers can request appointment reschedules through the shared calendar reschedule API.
  - Messages, booking queues, helper appointments, bids, and dashboard data poll on short intervals for real-time-lite updates.
  - Completed and closed jobs expose a native review form wired to `/api/reviews/jobs/:jobId`.

## Backend Contract

The mobile app is API-first. It should read from and write to the existing Node/PostgreSQL backend instead of duplicating platform logic.

Active mobile endpoints:

- `POST /api/mobile/push-token`
- `DELETE /api/mobile/push-token`
- `GET /api/mobile/feed`
- `GET /api/mobile/payment-config`
- `POST /api/mobile/invoices/:id/payment-intent`
- `POST /api/mobile/invoices/:id/confirm-payment`
- `POST /api/mobile/bookings/:bookingId/payment-intent`
- `POST /api/mobile/bookings/:bookingId/confirm-payment`
- `POST /api/mobile/helper/gallery`
- `GET /api/helpers`
- `GET /api/helpers/:id/profile`
- `POST /api/messages/conversations`
- `GET /api/messages/conversations`
- `GET /api/messages/conversations/:id`
- `POST /api/messages/conversations/:id`
- `POST /api/messages/conversations/:id/attachments`
- `GET /api/jobs`
- `POST /api/jobs`
- `POST /api/bookings`
- `GET /api/bookings/incoming`
- `GET /api/bookings/helper/:helperId/available-slots`
- `POST /api/bookings/:bookingId/accept`
- `POST /api/bookings/:bookingId/decline`
- `GET /api/bids/me`
- `POST /api/bids`
- `POST /api/bids/:id/withdraw`
- `GET /api/calendar/appointments`
- `POST /api/calendar/appointments/:id/reschedule-request`
- `GET /api/calendar/appointments/:id/reschedule-requests`
- `PUT /api/calendar/appointments/:id/reschedule-request/:reqId`
- `GET /api/calendar/availability/mine`
- `POST /api/calendar/availability`
- `DELETE /api/calendar/availability/:id`
- `GET /api/helper-profile/me`
- `PUT /api/helper-profile/core`
- `POST /api/helper-profile/services`
- `POST /api/helper-profile/policies`
- `GET /api/payments/connect/status`
- `POST /api/payments/connect`
- `GET /api/payments/me?role=payee`
- `GET /api/reviews/jobs/:jobId/eligibility`
- `POST /api/reviews/jobs/:jobId`
- `GET /api/planned-needs`
- `POST /api/planned-needs`
- `GET /api/invoices`

Planned mobile endpoints from the six-phase roadmap:

- `GET /api/mobile/nearby`
- `POST /api/mobile/offline-sync`
- `GET /api/business/:id/workspace/mobile-summary`

## Local Development

This workspace did not expose `npm` on the default shell path, so local verification used the Codex-bundled Node binary with a temporary npm bootstrap at `/tmp/codex-npm/package/bin/npm-cli.js`.

Standard development commands:

```bash
cd mobile
npm install
npm run typecheck
npm run ios
```

For Expo development builds:

```bash
cd mobile
npm run start
```

## Product Direction

This is a native companion app for the existing web platform, not a replacement for the web experience. Mobile should prioritize transaction-driving flows first: auth, posting jobs, finding helpers, bidding, messaging, scheduling, payments/status, tool rentals, trust/safety, notifications, and a Business Hub Lite. The full web Business Hub and admin surfaces remain the deeper desktop-grade workspace.
