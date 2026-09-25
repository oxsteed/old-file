# OxSteed email template system

## Current implementation

Transactional email rendering is centralized in `server/utils/emailTemplate.js`.
The renderer provides:

- a responsive table-based layout that works in mobile email clients;
- a preheader, branded header, readable hierarchy, one primary action, and a
  plain-text equivalent;
- light/dark color hints, RTL support for Arabic, escaped dynamic values, and
  fallback links when a button cannot be used;
- reusable code blocks, callouts, and detail rows for security and activity
  messages.

The shared layout is used by authentication, guest-chat verification, privacy,
security, notification, invoice, calendar, and quote-request email flows.
Guest-chat verification emails now preserve the selected interface language and
show the short-lived verification code separately from the 30-day conversation
access code.

## Delivery safeguards

`sendEmail` continues to use Resend's `Idempotency-Key` when a caller supplies
one. Welcome, privacy, security, notification, invoice, and quote-request
flows now provide stable keys; OTP sends intentionally remain unique for each
resend. Email addresses and verification values are never logged.

## Verification evidence

The following checks were run from the worktree:

```text
node --check server/utils/emailTemplate.js
node --check server/utils/email.js
node --check server/utils/invoiceEmail.js
node --check server/utils/calendarEmails.js
node --check server/services/notificationService.js
node --check server/services/guestProfileChatVerification.js
node --check server/controllers/chatController.js
node --check server/controllers/quoteRequestsController.js
git diff --check
```

A renderer smoke check also confirmed RTL output for Arabic and generated both
HTML and plain-text content with a preheader and call-to-action fallback link.
