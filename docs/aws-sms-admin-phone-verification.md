# Admin-triggered phone verification with AWS

OxSteed uses AWS End User Messaging SMS only for an explicit, per-user admin action. Normal user requests remain on the existing self-service path. The admin endpoint is protected by admin authentication, the `verify_users` permission, a one-hour admin rate limit, and a ten-minute per-user cooldown.

## Runtime settings

Set these server-side in Coolify. Do not use `VITE_` names for them and do not place them in browser code.

```env
AWS_SMS_ADMIN_VERIFICATION_ENABLED=false
AWS_SMS_REGION=us-east-1
AWS_SMS_ORIGINATION_IDENTITY=phone-number-id-or-pool-id
AWS_SMS_ACCESS_KEY_ID=
AWS_SMS_SECRET_ACCESS_KEY=
```

The service can use the existing dedicated Amazon Location credentials when the SMS-specific credentials are blank. A dedicated IAM role or user is preferred for production. The sending principal only needs `sms-voice:SendTextMessage`, scoped to the registered phone-number or pool ARN where possible.

AWS must have an approved origination identity and any required country registration before the flag is enabled. The application will fail closed when the flag, region, or origination identity is missing.

## Admin flow

1. An administrator opens a specific user in Admin and chooses **Verify Phone**.
2. The administrator supplies a reason. The API generates a six-digit code with `crypto.randomInt`.
3. AWS receives the code server-side. The raw code is never returned to the browser or stored in PostgreSQL.
4. The user enters the code through the existing authenticated phone verification screen at `/api/notifications/sms/verify-otp`.
5. A successful verification updates the user phone fields and records the challenge as verified.

The API route is `POST /api/admin/users/:userId/phone-verification-code` with `{ "reason": "..." }`. It returns only a masked phone number, expiry, provider, and challenge ID. It never returns the code.

## IAM policy shape

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "sms-voice:SendTextMessage",
      "Resource": "arn:aws:sms-voice:us-east-1:ACCOUNT_ID:phone-number/PHONE_NUMBER_ID"
    }
  ]
}
```

Use a pool ARN instead if the origination identity is a pool. Keep the feature flag off until the IAM permission, origination identity, registration, spend limit, and a separate operator-approved test recipient have all been verified. This repository does not send a test SMS as part of deployment.
