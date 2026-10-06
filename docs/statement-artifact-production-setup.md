# Statement artifact production setup

This runbook completes the operational part of private statement publication. The application intentionally refuses to publish a statement when this contract is incomplete.

## 1. Create and lock the R2 namespace

Use a dedicated private Cloudflare R2 bucket for issued statement originals and renditions. The current intended bucket is `oxsteed-statement-artifacts`.

Before enabling publication:

- Disable the bucket's `r2.dev` public development URL.
- Do not attach a public custom domain to the bucket.
- Use a bucket-scoped R2 token with only the object operations required by the statement service: read, write, and delete in this bucket. Do not reuse the public-upload or backup token.
- Decide and record retention, legal hold, and deletion rules for financial evidence before creating production statements. The application does not silently delete issued originals.
- If the organization needs object-access evidence, enable the provider's data-access logging and send it to a separate protected destination.

Changing public access or token permissions is an operator action in Cloudflare. Verify the result from a private browser session: a direct `r2.dev` object request must not return the object, while an application-issued short-lived signed URL must work for an authorized user.

## 2. Configure Coolify without putting secrets in code

Set these runtime variables on the production application. Enter access and secret values directly in Coolify; never paste them into source control, tickets, or chat.

```text
STATEMENT_ARTIFACT_BUCKET=oxsteed-statement-artifacts
STATEMENT_ARTIFACT_PREFIX=statements
STATEMENT_R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
STATEMENT_R2_ACCESS_KEY_ID=<bucket-scoped-access-key>
STATEMENT_R2_SECRET_ACCESS_KEY=<bucket-scoped-secret-key>
STATEMENT_R2_PRIVACY_ATTESTED=1
```

Only set `STATEMENT_R2_PRIVACY_ATTESTED=1` after the public-access and least-privilege checks above have been completed. The service validates that the endpoint is HTTPS Cloudflare R2, the namespace is not the public-upload or backup bucket, and all required credentials are present.

## 3. Deploy and verify

After deployment:

1. Confirm `/ready` contains `checks.statementArtifacts.ok: true`. This check is reported separately and does not take unrelated site traffic offline when statements are not configured.
2. Issue a synthetic statement through the existing admin or test workflow.
3. Confirm the job reaches `complete`, the artifact read-back hash matches, and the object exists in the private bucket under an opaque key.
4. Download it through the authorized statement route and confirm the response uses a short-lived signed URL with private/no-store cache headers.
5. Run the admin artifact reconciliation endpoint against a small batch and confirm zero missing or corrupt objects.
6. Exercise a failed upload and retry. A job must never become complete without a verified object, and an uncertain upload must be reconciled before retry.
7. Record the deployment revision, bucket, retention decision, verification timestamp, and operator in the operations log.

Do not use a direct public object URL as a production verification method. The statement service never publishes originals through the public upload adapter or a local-storage fallback.

## 4. Recovery and rotation

If the storage credential is rotated, update both values in Coolify and redeploy or restart the worker. Keep the old credential valid until the worker health and a signed download have been verified, then revoke it. If the bucket is unavailable, leave publication disabled and use the existing retry/reconciliation workflow; do not substitute the backup bucket.

## 5. Accessibility sign-off remains separate

Automated PDF/HTML structure checks do not replace the manual screen-reader matrix in `docs/statement-screen-reader-checklist.md`. Record human results for the supported reader/viewer combinations before claiming screen-reader verification or PDF/UA conformance.
