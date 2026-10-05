# Messages initialization crash

## Root cause

The signed-in `/messages` route showed the generic error boundary. Its production
console reported `ReferenceError: Cannot access 'N' before initialization` in
the minified MessagingWorkspace chunk. A real React render of the source
reproduced `Cannot access 'conversations' before initialization`.

The conversation-ref mirror effect appeared before the conversation state
declaration. React evaluates its dependency array during render, before the
effect callback runs, so its `[conversations]` dependency triggered the error.

## Repair

Move the mirror effect below the state declarations, while retaining its
position before fetch/realtime effects. Preserve the socket update logic,
pagination, account access, API contracts, and message handling.

## Prevention and verification

The existing messenger client-fix suite now renders the actual workspace with
real React hooks. Only providers and child components are stubbed. It exercises
customer, helper, business, embedded, conversation, and guest inquiry entry
points with both connected and disconnected socket states. SSR avoids API
calls and external messages; these are render checks, not live send tests.

- New test failed with the exact source error before the repair and passed after.
- Messenger client-fix, shell, and dock suites: 96 tests passed.
- `npm run build:ci`: passed, including translations, TypeScript, production
  build, and verification of 699 emitted assets.
- `git diff --check`: passed.

Live acceptance requires the corrected image, healthy `/ready`, and a signed-in
Messages page that loads after fetching its inbox. No production message is
sent as a test. Existing unrelated audit files remain untouched.
