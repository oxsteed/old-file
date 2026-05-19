# OxSteed Mobile

Expo React Native + TypeScript app for building a native iOS/Android companion to the current OxSteed web platform.

## Current Shape

- `mobile/package.json`, `mobile/app.json`, `mobile/App.tsx`, and `mobile/src/**` are the active mobile app surface.
- The app uses Expo, React Navigation bottom tabs, TanStack Query, Zustand, SecureStore, and Expo Notifications.
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
- Phase 2 has an initial foothold:
  - Customer dashboard reads the consolidated `/api/mobile/feed` payload.
  - Post Job submits a first native transaction through `/api/jobs`.
  - Helper dashboard summarizes available jobs, booking requests, messages, and business ownership from the same mobile feed.

## Backend Contract

The mobile app is API-first. It should read from and write to the existing Node/PostgreSQL backend instead of duplicating platform logic.

Active mobile endpoints:

- `POST /api/mobile/push-token`
- `DELETE /api/mobile/push-token`
- `GET /api/mobile/feed`

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
