# OxSteed App Store Release Checklist

## Accounts

- Apple Developer Program enrolled for the legal OxSteed seller name.
- App Store Connect app record created for `OxSteed`.
- Google Play Console app record created if Android is shipping at the same time.

## App Identity

- Bundle ID: `com.oxsteed.app` unless a different final identifier is chosen.
- Apple Team ID: `ZBRGSDRRU7`.
- App name: `OxSteed`.
- Primary website: `https://oxsteed.com`.
- Support URL: `https://oxsteed.com` or a dedicated support page.
- Privacy Policy URL: `https://oxsteed.com/privacy`.

## Native Capabilities

- Push Notifications enabled in Apple Developer portal and Xcode.
- Associated Domains enabled with `applinks:oxsteed.com`.
- Production server has `APPLE_TEAM_ID=ZBRGSDRRU7` set so `/.well-known/apple-app-site-association` serves the real app ID.
- Production server has `APNS_ENV=production`, `APNS_TEAM_ID`, `APNS_KEY_ID`, and APNs private key secret configured for iOS push.
- Firebase Cloud Messaging API v1 is enabled; Firebase service account secrets are only needed for Firebase-issued/Android tokens.
- Production API has migration `183_mobile_push_tokens.sql` applied.
- Production API accepts `POST /api/mobile/push-token` and `DELETE /api/mobile/push-token`.
- Existing notification flows call the mobile sender through `server/services/notificationService.js`.

## Assets

- App icon exported from the OxSteed brand mark.
- iPhone screenshots: 6.7-inch and 6.5-inch sizes.
- iPad screenshots if iPad support remains enabled.
- Android phone screenshots for Google Play.
- App Store description explains marketplace utility, not only website access.

## Review Notes

Mention that OxSteed is an account-based local trades marketplace. Native app functionality includes authenticated job, bid, booking, messaging, push notification, deep-link, offline, and external-link handling.

## Current Upload

- iOS build `1.0 (1)` for `com.oxsteed.app` was uploaded to App Store Connect on 2026-05-09.
- Finish App Store Connect processing, TestFlight setup, screenshots, privacy answers, and App Review submission in the Apple web UI.
