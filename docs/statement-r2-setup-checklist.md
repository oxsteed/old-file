# Private statement R2 setup and acceptance

Status: bucket created 2026-10-05; remaining configuration and acceptance not
performed.
This is an operator checklist, not authorization to change payout controls or
reissue evidence. Use [deployment ownership rules](deployment-ci.md),
[statement operations](statement-operations-runbook.md), and
[the verification report](statement-payout-verification-2026-10-05.md).

## Provider configuration

- [x] Create a dedicated private Cloudflare R2 bucket, separate from public
  uploads and backups. Created `oxsteed-statement-artifacts`, location Eastern
  North America (ENAM), Standard class, initially empty.
  [Create buckets](https://developers.cloudflare.com/r2/buckets/create-buckets/)
- [x] Verify bucket public access is disabled, the public development URL is
  disabled, and no custom domain is assigned. Review Workers bindings/routes or
  other integrations before attesting. These three bucket controls were visibly
  disabled/absent in Cloudflare on 2026-10-05; broader account integrations have
  not been checked.
  [Public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/)
- [ ] Create an R2 S3-compatible token with Object Read & Write scoped to this
  bucket. Keep bucket-administration authority separate from runtime object
  access. Enter credentials directly into Coolify's runtime secret store; do
  not paste them into chat, source, screenshots or command output.
  [R2 authentication](https://developers.cloudflare.com/r2/api/tokens/)
- [ ] Obtain the account's correct R2 S3 endpoint, including jurisdiction where
  applicable. The adapter accepts an HTTPS account endpoint, not a public
  delivery URL, custom hostname, path or query string.
  [R2 S3 setup](https://developers.cloudflare.com/r2/get-started/s3/)
- [ ] Record an owner-approved retention period, legal-hold process, expiration
  authority and recovery policy. Do not invent a duration. Review lifecycle
  deletion against required evidence retention and the application's cleanup.
  R2 bucket locks can prevent overwrite/deletion; locks take precedence over
  lifecycle deletion while applicable. Rehearse cleanup/restore compatibility
  on disposable objects before choosing lock rules.
  [Bucket locks](https://developers.cloudflare.com/r2/buckets/bucket-locks/)
  Cloudflare currently shows no lifecycle expiration rule and no bucket lock
  rule for this bucket. No retention duration has been selected.

## Coolify runtime settings

Supply these to the server runtime of the correct application. None belong in
`VITE_*` or client build configuration. Mark completion by presence only; never
copy resolved credential values into the evidence record.

| Setting | Required action |
| --- | --- |
| `STATEMENT_ARTIFACT_BUCKET` | Dedicated private statement bucket name |
| `STATEMENT_R2_ENDPOINT` | Correct HTTPS account R2 S3 endpoint; prefer this dedicated setting over generic endpoint fallback |
| `STATEMENT_R2_ACCESS_KEY_ID` | Dedicated bucket-scoped R2 access key, entered directly into secret store |
| `STATEMENT_R2_SECRET_ACCESS_KEY` | Matching secret, entered directly into secret store |
| `STATEMENT_R2_PRIVACY_ATTESTED` | Set to `1` only after the provider privacy/access review above |
| `STATEMENT_ARTIFACT_PREFIX` | Optional; default `statements`; preserve any existing namespace |
| `STATEMENT_LEGACY_PREFIXES` | If historical prefixes exist, record them so generic storage routes continue blocking their keys |

The bucket must differ from the application's configured upload and backup
bucket names. The privacy flag is an attestation, not an API check of actual
provider privacy. Presence of these settings does not prove successful issuance.

### Owner handoff: token, Coolify, and retention

The `oxsteed-statement-artifacts` bucket has been created. At verification it
was in Eastern North America (automatic location), Standard storage class,
empty, with public access and the development URL disabled, no custom domain,
no lifecycle expiration, and no bucket-lock rule. The default multipart-upload
abort after seven days was enabled. Bucket creation and visible privacy
settings do not verify account-level access or other integrations.

The account owner should create a new R2 S3 token with Object Read & Write
access scoped only to `oxsteed-statement-artifacts`, store its credentials in
the approved secret manager, and enter them directly in Coolify. Do not paste
secret values into chat or repository files. Configure the bucket name, its
account-specific S3 endpoint, `STATEMENT_R2_ACCESS_KEY_ID`, and
`STATEMENT_R2_SECRET_ACCESS_KEY`; set `STATEMENT_R2_PRIVACY_ATTESTED=1` only
after reviewing remaining privacy controls. Apply the variables together
through the existing deployment process so a partial credential change does
not interrupt issuance.

The owner should choose and record a retention period and any legal-hold
requirements with the provider before originals are placed in the bucket. No
credentials, Coolify variables, lifecycle rule, deployment, issuance, or
object-write verification were performed in this pass.

- [ ] Apply settings to the correct runtime application; retain deployment
  ownership and existing Colima context. No volume deletion or parallel stack.
- [ ] Deploy through the existing process and record the exact deployed revision.
  Verify `/ready` and migrations against that revision; health from an older
  release does not prove the settings or code were deployed.
- [ ] Keep `PAYOUT_PROCESSOR_ENABLED` unset or false. Preserve the existing Credit
  activation controls. Storage configuration does not authorize money movement.

## Issuance and download acceptance

Rehearse first with synthetic accounts in an isolated environment and a separate
test bucket. In production use the approved issuance policy and eligible account;
prefer observing its normal run. Manual run creation issues evidence and customer
notifications, so use it only as part of the approved issuance procedure.

1. Confirm the approved activation month, closed UTC month, product eligibility,
   and issuance grace period. Do not shorten grace or activate historical months
   merely to make a test run. Record run and job IDs.
2. In `/admin/super/statement-operations`, confirm discovery completes and the
   intended job reaches complete. Check failures, dead letters, stale leases,
   and missing coverage. Use existing retry controls only for failed/dead-letter
   jobs; do not replay financial captures/payouts or recreate issued originals.
3. Verify the expected original artifact has state ready, the dedicated bucket,
   opaque UUID object key, byte length, SHA-256 and snapshot/document linkage.
   Confirm that exact object exists in the private bucket. A listing alone is
   insufficient: validate size/hash on an authorized read-back. The operator
   reconcile endpoint is bounded and selects oldest ready artifacts first;
   confirm the specific acceptance artifact was actually examined.
4. Download the original as its authorized owner. Compare downloaded byte length
   and SHA-256 with recorded original evidence. Test the accessible HTML rendition
   separately; it is generated on demand, not proof of a stored original object.
5. Verify logged-out and unrelated-owner access is denied without leaking document
   ownership. Verify generic public/files storage routes refuse statement keys,
   and inspect provider public-domain settings directly. Treat signed download
   URLs as private bearer access; do not log or share them. Verify expiration.
6. Confirm `statement.ready` delivery drains or records a retryable failure with
   its existing deduplication evidence. No duplicate document or notification
   intent should be created by retrying the issuance job.
7. On isolated targets only, remove bucket configuration and test storage outage,
   uncertain upload, corrupt read-back and restart recovery. Publication must
   refuse ready/issued without verified bytes. Do not delete or corrupt a real
   original to test the failure path.
8. Rehearse database-plus-object restore in an isolated target with the approved
   retention/lock policy. Confirm the frozen original can be retrieved with its
   original hash after restore. Backups stay local under the current project
   policy; any off-device destination requires its own agreed operational setup.

## Evidence and sign-off

| Check | Evidence to record (redacted) | Status |
| --- | --- | --- |
| Bucket privacy and access | Bucket `oxsteed-statement-artifacts`, ENAM; public access disabled; no public development URL or custom domain; broader account integrations and token scope remain to review | Partial |
| Retention and hold | Policy owner, duration, rule review, restore/cleanup result | Not decided here |
| Runtime/deployment | Required settings present, revision, `/ready`, migrations | Not run |
| Issuance | Product/period/run/job IDs, completion/failure counters | Not run |
| Stored original | Artifact/document IDs, object identity, length/hash match | Not run |
| Authorized and denied access | Owner success, unrelated/logged-out denial, private-route checks | Not run |
| Delivery and recovery | Outbox outcome, retry dedupe, isolated outage and restore evidence | Not run |

Accept storage activation only after actual private-provider settings, deployed
revision, verified original and access results are recorded. This checklist does
not establish screen-reader acceptance or payout safety.
