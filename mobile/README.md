# OxSteed Mobile

Capacitor shell for publishing OxSteed to the iOS App Store and Google Play while keeping the existing website as the primary product surface.

## What this app does

- Loads the production OxSteed website in a native Capacitor WebView.
- Enables native deep links and universal-link routing into the same web routes.
- Provides native status bar, splash screen, keyboard, offline, and external-browser handling.
- Pairs with the web bridge in `client/src/utils/mobileBridge.js` so signed-in users can register APNs/FCM push tokens.

## Setup

```bash
cd mobile
npm install
npm run build
npm run ios:add
npm run android:add
npm run cap:sync
```

Set a different target URL when syncing native projects:

```bash
OXSTEED_APP_URL=https://staging.oxsteed.com npm run cap:sync
```

On the current Mac, the system Ruby is 2.6. If `pod install` fails with an ActiveSupport `Logger` error, run Capacitor sync with:

```bash
RUBYOPT=-rlogger npm run cap:sync
```

## iOS

```bash
cd mobile
npm run cap:ios
```

In Xcode:

- Set the bundle identifier to `com.oxsteed.app` or the final App Store identifier.
- Select the OxSteed Apple Developer team.
- Enable Push Notifications.
- Enable Associated Domains and add `applinks:oxsteed.com`.
- Team ID discovered in Xcode: `ZBRGSDRRU7`. Set `APPLE_TEAM_ID=ZBRGSDRRU7` in production so `/.well-known/apple-app-site-association` returns the final `ZBRGSDRRU7.com.oxsteed.app` app ID.
- Add production APNs provider credentials to the API environment before relying on TestFlight/App Store push delivery:

```bash
APNS_ENV=production
APNS_BUNDLE_ID=com.oxsteed.app
APNS_TEAM_ID=ZBRGSDRRU7
APNS_KEY_ID=...
APNS_PRIVATE_KEY_PATH=/run/secrets/AuthKey_XXXX.p8
```

The server also supports `APNS_PRIVATE_KEY` or `APNS_PRIVATE_KEY_BASE64` instead of a file path.

## Android

```bash
cd mobile
npm run cap:android
```

In Android Studio:

- Set the application ID to `com.oxsteed.app` or the final Play Store identifier.
- Add `google-services.json` once Firebase Cloud Messaging is configured.
- Generate a release signing key before producing the Play Store bundle.

## Store Review Notes

The app should be submitted as the OxSteed marketplace app, not as a generic website wrapper. Native functionality to call out in review notes:

- Account-authenticated job, bid, booking, message, and marketplace workflows.
- Push notification registration for job, booking, message, and reminder alerts.
- Native deep links from notifications into OxSteed routes.
- Native offline and external-link handling.
