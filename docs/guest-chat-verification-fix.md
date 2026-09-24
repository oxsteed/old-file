# Guest profile verification repair - 2026-09-24

Helper/business verification inserted a session using the default
`waiting_for_helper` status without `helper_response_deadline`. The production
`check_deadline_during_waiting` constraint rejected the insert before OTP delivery.
Support uses separate tables and was unaffected.

The pending session now receives a deadline matching the 15-minute OTP window.
Successful verification resets the helper response deadline to five minutes.
The timeout worker excludes sessions that have not completed email verification.

Verification:
- Three focused Jest suites passed, 17 tests total: guestProfileChatVerification,
  profileChatRouting, and profileChatIdempotency.
- Reproduced the constraint failure using connection-local PostgreSQL temporary
  tables cloned with production defaults and constraints.
- Repeated with the patched service for both helper and business targets:
  start succeeded, incorrect codes were rejected, correct codes issued a token,
  and reused codes were rejected.
- Email delivery was stubbed for these tests; no real emails were sent and no
  customer records were changed. A real inbox/browser round trip remains a
  post-deployment user check.
