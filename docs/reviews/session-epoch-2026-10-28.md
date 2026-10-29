# Stale authentication work and bounded refresh recovery

Part of requirement 7 of the eight-improvement goal. The provider previously
guarded some verification callbacks, but the Axios interceptor could still let
an older refresh clear a newer account, overwrite its stored profile, or retry
the original request after an account change. Refresh requests and native lock
queues could also wait without a deadline.

## Resulting behavior

- Each request records an in-memory authentication epoch. Credential-changing
  requests advance it before a response can set cookies. Successful session
  handoffs, verified account changes and clearing authentication advance it too.
  It contains no credential or stored identity and is not authentication proof.
- Stale 401s cannot start refresh. A stale refresh cannot persist an older
  profile, clear the current session, or retry the original read/write. The
  request interceptor rechecks retry dispatch as well as refresh completion.
- The provider checks both its identity epoch and the transport epoch before
  accepting verification success/failure. Older verification failures after
  password, two-factor or OTP sign-in cannot clear the newer account.
- Explicit and interceptor-triggered refresh calls share one flight per epoch.
  An older flight's cleanup cannot remove a newer flight. Each refresh POST has
  a ten-second timeout, including the one-time legacy fallback. The existing
  cross-tab lock still serializes rotation; waiting for it is bounded at thirty
  seconds. Timing out does not bypass another valid storage-lock owner.
- Temporary HTTP failures, timeouts, lock contention, and a successful HTTP
  response without refresh proof preserve a verified session. Cold unverified
  sessions retain the existing localized recovery boundary. Real expiry still
  clears authentication. Credential-rejection endpoints do not recursively
  refresh or expire an unrelated verified session.
- Production web responses omit raw token fields (`bodyTokens` in the server's
  `authCookies.js`). Successful cookie handoffs now remove legacy browser
  credentials even without those fields; the synthetic service uses that actual
  cookie-only protocol. Legacy body-token migration remains restricted to an
  explicit server `no_token` response.

## Regression evidence

The delayed-success/account-switch scenario was run against committed
`6b408a29` authentication modules using the same synthetic HTTP fixture. It
failed because the older profile replaced the newer account's stored profile.
The fixed source passes that scenario and checks that the original synthetic
private POST is sent once. No production accounts or writes are used.

The HTTP fixture acknowledges when the server actually holds the response,
captures its original account/failure, and publishes no-store headers before
holding a verification body. This avoids browser request coalescing or timing
assumptions masking the race. Native-lock and storage-fallback tests also cover
queue timeout, active-operation ownership, stale locks, error cleanup,
replacement owners, and unavailable browser storage.

## Cross-tab transition follow-up (2026-10-29)

The browser now publishes a versioned, account-id-only transition event through
`BroadcastChannel` with a storage-event fallback. A login, account switch, or
logout in another tab fences in-memory requests, clears the previous account's
navigation and job-draft scope, and re-verifies the shared cookie before a new
private view is rendered. No token, profile, or draft payload crosses the tab
boundary.

The expanded login/session browser check covers two tabs changing from one
synthetic account to another and then logging out; the full suite passes 15
tests. This closes the cross-tab notification and stale private-view portion
of requirement 7. Concurrent login/logout cookie ordering and additional
feature-specific draft surfaces still require their own acceptance checks.

Require green PR CI and publication evidence before accepting this package as
shipped; keep the broader session goal open until those remaining cases pass.
