# Session cookie response ordering

The existing epoch checks discarded stale refresh data and prevented a private
request from replaying after a login. They did not control when the browser
applied response cookies. A delayed successful refresh could arrive after a
new password login and overwrite that login's cookies.

The browser fixture now sets an HttpOnly identity cookie alongside its
synthetic access and refresh cookies. Before the fix, its existing delayed
refresh/new-login case kept the new account in React and localStorage but
ended with the old account in that cookie. This failed the added assertion.
The test uses synthetic users and cookies.

Requests that change session cookies now use the same coordinator as refresh.
The Axios adapter holds the lock until the network response has completed, so
the browser processes those cookies before the next operation starts. Epoch
checks still fence response data and private retries. The adapter is wrapped
once, allowing protected profile requests to refresh and retry without
acquiring the lock recursively. It reads the current CSRF value when the
request actually starts.

The endpoint classifier covers password, two-factor, passkey, registration OTP,
helper registration OTP, internal sign-in, logout and mode switches. Profile
writes that can rotate a mode's session are coordinated, while ordinary profile
reads keep their existing behavior. The existing Web Locks implementation and
its compatibility fallback remain the coordinator.

The browser cases now queue a newer login behind the held refresh response.
They verify the final HttpOnly cookie, authenticated UI and stored account,
and confirm that a private write is not replayed. A new two-tab case holds a
refresh in one tab and queues logout in the other. Logout reaches the server
after the rotation finishes, all synthetic session cookies clear, and the
first tab leaves its private view.

The focused coordinator and browser suites passed 24 tests. A later targeted
run passed six cookie/profile cases, including the new expired-profile retry
and refreshed CSRF assertion. The full production client build passed.
Remote CI and publication remain pending.
The full eight-improvement goal remains active until publication and the
remaining product acceptance checks are complete.
