# Gift-card delivery, physical fulfillment and reconciliation

This completes the software workflows in follow-up item 8. Gift-card value stays in the existing restaurant-scoped internal ledger. This change neither collects a purchase payment nor integrates a separate gift-card value processor. An external statement is recorded as operator-supplied evidence, not asserted as independently verified provider settlement.

## Delivered workflows

- Merchant issuance requires a recipient email for an e-gift, supports a gift message and en/es/fr/ht/ar, and atomically creates value, its issue ledger entry, an encrypted fulfillment envelope and a required business audit. A transaction-level issue lock and request fingerprint bind retries to the original product/recipient/expiry/code. Identical concurrent requests create one funded card. Changed requests conflict. The browser preserves the retry identity for identical requests across a lost response/reload for two hours; session storage contains only an opaque request digest and retry identity.
- E-gifts use the existing Resend email transport. The existing shared worker scheduler runs the outbox once per minute, behind `RESTAURANT_GIFT_CARD_DELIVERY_ENABLED=false` by default and the shared email-configuration check. Database leases fence acknowledgements from stale workers. Message contents and sender are encrypted and pinned for identical retries across a deployment. No email, code or encryption key is written into audit history or ordinary card/status lists.
- Provider acceptance is shown as accepted, not delivered. The worker polls the provider's sent-email status and records delivery/failure. It retries the same send identity at most eight times and stops automatic retries after 23 hours. An old uncertain send requires operator evidence; it is never blindly retried after the provider's deduplication window. Confirmed unsent/bounced attempts can be restarted for the same funded card, with an optional corrected recipient. Confirmation and retry actions are audited and replay safely. Delivered payloads are purged.
- Physical products support either a server-generated code or an existing preprinted code. An authorized manager opens a private, escaped, printable card and prints it through the browser onto the chosen stock. Print access is audited; the HTML is non-cacheable and disallows external content and framing. Recording a receipt/handoff reference marks the card handed out and purges the encrypted artifact. Repeating the same handoff reference acknowledges the saved handoff; a conflicting reference rejects. Ordinary lists retain only the final four code characters.
- Reconciliation compares card value with the sum of its append-only ledger and a recorded external statement balance. It saves the statement source, reference, currency, observed internal/ledger balance, ledger watermark, discrepancy and operator. Repeated identical evidence replays; conflicting evidence rejects. Later ledger activity marks the statement stale. The merchant can page records, identify internal ledger mismatches and export the current reconciliation page as sanitized CSV. Recording discrepancies never adjusts value. The ledger and reconciliation tables reject update/delete.
- Brand gift-card management requires the existing catalog/value permissions plus all-store authority. Assigned-store staff do not gain access to brand-wide cards or statements. Existing authorized POS redemption stays on its original payment path.
- The encrypted fulfillment envelope expires after 30 days. Cleanup runs even when email delivery is disabled. Expired artifacts cannot be printed or resent; physical handoff or confirmed email delivery can still be recorded with evidence. Legacy cards whose codes were previously lost cannot be reconstructed; their balances and ledger remain available for statement reconciliation.

## API

All paths are under authenticated `/api/restaurants/:restaurantId` and retain the restaurant gate:

- `POST /gift-cards`: existing issue contract plus `recipientEmail`, `language`, `message`, optional `physicalCode`; stable `Idempotency-Key` required.
- `GET /gift-cards?before=<fulfillmentId>`: 50-row fulfillment/status pages and delivery capability.
- `GET /gift-cards/:cardId/print`: guarded physical artifact.
- `POST /gift-cards/:cardId/handoff`: `{reference}`.
- `POST /gift-cards/:cardId/delivery-resolution`: `{action: confirm_delivered | confirm_not_sent, evidence, recipientEmail?}`.
- `POST /gift-cards/:cardId/reconciliation`: `{source, externalReference, currencyCode, externalBalanceCents, note?}`. `externalBalanceCents` is an exact, nonnegative ISO currency minor-unit amount, including zero.
- `GET /gift-cards/reconciliation?before=<cardId>&format=csv`: JSON or CSV, 50 cards per page. Currency columns are retained; currencies are never summed together.

## Deployment and acceptance

Migration `99982_restaurant_gift_card_fulfillment.sql` is additive and leaves all prior migration bytes intact. Deploy through the existing pipeline. Keep the delivery flag disabled until an operator verifies the existing Resend sending domain, runtime encryption configuration and a controlled recipient test. Use runtime secret injection; never put credentials in client variables or repository files. This work did not send real messages, issue live value, change Credit/growth gates, apply production migrations or deploy.

For real acceptance: issue a controlled e-gift, verify accepted then delivered, redeem/refund through the existing POS and compare the ledger to the external statement. Exercise a provider rejection and documented unsent retry. Print a physical card on the chosen stock, scan/type its code at the POS, record handoff and verify reprinting is denied. Physical stock, production email deliverability and real external evidence require operator acceptance.

Provider API basis: [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys) retains send keys for 24 hours; [retrieve sent email](https://resend.com/docs/api-reference/emails/retrieve-email) exposes `last_event`. Provider lookup responses are reduced to identity/event; message bodies are never returned by the reconciliation helper.

## Verification

Commands actually run and final results are recorded after the verification pass below. Tests use synthetic loopback databases and mocked providers only.

- **107 focused server tests passed across 10 suites**, including **15 actual PostgreSQL cases** for concurrent issue/replay, encrypted payloads, recipient rollback, preprinted codes, handoff replay/purge, accepted-versus-delivered polling, stable retry identity, expired-window review, concurrent worker claims, immutable/current reconciliation, tenant isolation, private print headers, mandatory audit rollback, stale lease fencing, resolution replay, retention while disabled and bounced delivery. Provider protocol and all-store/permission denial cases are included.
- **565 client smoke tests passed**, with no skipped cases.
- **One actual Chromium merchant workflow passed**: KWD precision, a lost issuance response retried with the same identity, the printable popup, physical handoff, corrected recipient resolution and a zero-balance statement.
- **1,002/1,002 migrations applied and replayed** through the complete migration runner in a disposable Colima PostgreSQL container. No production database was used.
- `client/npm run build:ci` passed localization, typecheck, production compilation and **1,074 emitted assets**. The PWA startup budget passes at **750,864 JavaScript / 230,031 gzip bytes**. Growth instrumentation check passes.
- CI YAML parsing, JavaScript syntax checks and `git diff --check` pass. CI explicitly creates a migrated disposable `gift_card_test` and runs its PostgreSQL suite, so these cases cannot silently skip in that step.

```sh
# Repository root; URL must target the explicit disposable loopback gift_card_test.
GIFT_CARD_TEST_DATABASE_URL=<disposable-url> npm --prefix server test -- --runInBand --testPathPatterns='restaurantGiftCard|restaurantThirtyFixes.test|routeScopeGuard|scheduledWorkerSchedule.test|notificationEmailFailurePropagation|emailListUnsubscribeHeaders'
DOCKER_CONTEXT=colima node scripts/migration-rehearsal.cjs --timeout-ms 600000
# client/ working directory
node --test scripts/*.test.mjs
node --test scripts/restaurantGiftCards.browser-check.cjs
npm run build:ci
node scripts/growthInstrumentation.mjs --check
node scripts/measurePwaStartup.mjs
```

The expected injected rollback/provider errors in test logs are passing error-path coverage. Remote CI, real email delivery, physical stock/printer output and production external-statement acceptance are separate from these local results.
