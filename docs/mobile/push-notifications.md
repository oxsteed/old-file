# OxSteed Native Push Notifications

This repo now has the first production building block for mobile push:

- `client/src/utils/mobileBridge.js` asks for native push permission inside the Capacitor app only.
- `POST /api/mobile/push-token` stores the signed-in user's APNs or FCM token.
- `DELETE /api/mobile/push-token` disables a token for the signed-in user.
- `server/migrations/183_mobile_push_tokens.sql` creates the token registry.
- `server/services/mobilePushService.js` sends enabled mobile tokens through APNs or Firebase Cloud Messaging.
- `server/services/notificationService.js` fans existing OxSteed notifications out to native mobile push when mobile credentials are configured.

## Production Secrets

For the current iOS Capacitor app, APNs is the direct sender path. TestFlight and App Store builds use production APNs.

```bash
APNS_ENV=production
APNS_BUNDLE_ID=com.oxsteed.app
APNS_TEAM_ID=ZBRGSDRRU7
APNS_KEY_ID=...
APNS_PRIVATE_KEY_PATH=/run/secrets/AuthKey_XXXX.p8
```

Instead of `APNS_PRIVATE_KEY_PATH`, production can use `APNS_PRIVATE_KEY` with escaped newlines or `APNS_PRIVATE_KEY_BASE64`.

For future Android or Firebase-issued tokens:

```bash
FIREBASE_PROJECT_ID=oxsteed
FIREBASE_SERVICE_ACCOUNT_PATH=/run/secrets/firebase-service-account.json
```

Instead of `FIREBASE_SERVICE_ACCOUNT_PATH`, production can use `FIREBASE_SERVICE_ACCOUNT_JSON` or `FIREBASE_SERVICE_ACCOUNT_BASE64`.

## Payload Shape

When the push sender is added, include one of these data fields so notification taps route into the app:

```json
{
  "title": "New message",
  "body": "You have a new OxSteed message.",
  "data": {
    "route": "/messages"
  }
}
```

Accepted route keys are `route`, `path`, `url`, or `deepLink`. The client only follows same-origin OxSteed routes.

## Remaining Push Delivery Work

- Add production APNs credentials to production secrets. Firebase currently shows a development APNs key and no production APNs key.
- Apply migration `183_mobile_push_tokens.sql` before releasing the mobile build.
- Send a real TestFlight notification after App Store Connect finishes processing the uploaded build.
