# Media composer follow-up verification

Reviewed after pulling `origin/old-files-claude` at `67fbf162`.
The main composer upgrade and migration `758_oxsteed_media_composer.sql`
were already present. This follow-up closes verified recovery and delivery gaps.

## Changes

- Serialize autosave, manual save, metadata saves, and publication. Earlier
  responses cannot acknowledge newer text or alternative-text edits.
- Preserve the exact initial creation request across lost responses and reloads;
  scope recovery keys to the signed-in user. Never substitute another publisher
  for an unavailable saved identity. Existing server drafts remain selectable.
- Reconcile upload-response loss against server-computed file digests. Block
  publication with unacknowledged files; prevent draft switching during asset
  mutations and protect local metadata from processing polls.
- Save the current draft before Start new; retain it in Your drafts. Failed
  deletion preserves the draft. Warn on unacknowledged reloads and link navigation.
- Preserve replacement ordering at four-asset capacity; reject replacement with
  another attachment already in the draft. Keep blocked-media protections.
- Reject caption uploads to photos, preserve existing metadata when omitted,
  and clean up superseded caption objects only after checking durable references.
- Render image alternative text, video caption tracks, and acknowledged
  content-warning reveals. Withheld media is not mounted before reveal.
- Use authoritative currency precision, including zero-decimal currencies.
- Fix narrow-screen location overflow and publisher-selector overlap; keep the
  mobile support control from covering Save/Publish.
- Bring older isolated publishing fixtures up to migration 758, and allow the
  real-video test to use `FFMPEG_PATH` instead of a hardcoded Linux executable.

## Evidence

From `server/`, against a fresh loopback-only disposable PostgreSQL 15 container:

- `mediaDraftAttachmentsDb`, `mediaDraftAttachments`, `mediaAttachmentRecovery`,
  `mediaContracts`, `mediaVerification`: 82 tests passed, none skipped.
- `mediaPublishDrafts`, `mediaPublishUpload`, `mediaPublishSafety`,
  `mediaPublishTranscode`, `mediaTranscodeWorker`, `mediaPublisherRecognition`,
  `mediaAccess`, `mediaSafetyPolicy`, `mediaUrlValidation`: 128 tests passed,
  none skipped. Real FFmpeg conversion was exercised using the user-local binary.

From `client/`:

- `npm run build:ci`: passed, including frontend reference checks, locale gates,
  type checking, production compilation, and verification of 771 emitted assets.
- `node --test scripts/mediaPublishing.browser-check.cjs
  scripts/mediaShell.browser-check.cjs scripts/mediaDiscovery.browser-check.cjs`:
  all 28 checks passed.
- Additional composer screenshot/keyboard rerun passed at 320, 390, 768, and
  1366 CSS pixels, light English and dark Arabic RTL, with reduced motion.
  Also tested 683x450 CSS pixels at scale 2 as a 200% desktop zoom reflow equivalent.
  Checked for horizontal overflow, readable publisher identity, selector overlap,
  mobile action/nav overlap, and keyboard emoji insertion with focus return.

## Boundaries

No production accounts, posts, credentials, or moderation decisions were changed.
The isolated suites apply actual Media migrations in temporary schemas, not the
entire application migration history. Full local migration rehearsal was not
completed because the plain PostgreSQL container does not include PostGIS.

Browser fixtures use synthetic data and real components, not live account
submissions. They establish rendering and state behavior, not a human screen-reader
pass or live storage/CDN caption compatibility. Existing safety and video identity
verification checks remain in force. CI and deployment must be reported separately
after push; a local build is not proof of deployment.
