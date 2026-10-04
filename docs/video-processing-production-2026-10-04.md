# Video processing deployment verification

## Observed before this repair

The live image at commit `81ad2697` had a healthy ClamAV sidecar and runtime
settings `CLAMAV_HOST=clamav`, `CLAMAV_PORT=3310`. A harmless buffer received
`clean=true`, `skipped=false`, `provider=clamav`. A separate direct INSTREAM
diagnostic using the standard benign EICAR antivirus test string received
`FOUND` from the live scanner. No customer file was uploaded or published.

The app lacked `/usr/bin/ffmpeg`, `VIDEO_WORKER_ENABLED` was unset, and its
startup log reported that the video worker was disabled. `CSAM_VENDOR` was
unset. Existing upload quarantine and CSAM checks were not bypassed.

## Repair

- Install FFmpeg in the final production image; verify both FFmpeg and ffprobe
  execute during the image build.
- Default the production Compose worker setting to `1`, preserving an explicit
  operator override to disable it. Wire binary paths and polling interval.
- Add deployment-contract regression tests. No synthetic safety verdict,
  credentials, or CSAM vendor defaults were added.

Local scanner/media/deployment tests: 4 suites, 95 tests passed.
Deployment acceptance additionally requires a newly built live image, a worker
startup log, executable binaries, and healthy `/ready`.

## CSAM activation blocker

Do not describe the existing CSAM adapters as certified integrations. They
submit a whole-file SHA-256 and interpret assumed response shapes. Obtaining a
token alone does not validate these adapters against a vendor's production
contract, fingerprinting requirements, or approved scope.

- [Google's partner documentation](https://protectingchildren.google/tools-for-partners/)
  describes local video fingerprinting software and submission of the resulting
  fingerprint to CSAI Match. A whole-file SHA-256 is not that workflow.
- [Microsoft's PhotoDNA FAQ](https://www.microsoft.com/en-us/PhotoDNA/FAQ)
  states its public Cloud Service is currently image-only and credentials follow
  organizational vetting. Do not configure it as a verified whole-video scanner.
- [Thorn Safer](https://safer.io/) offers vendor-assisted deployment. Obtain the
  approved API/fingerprinting documentation, commercial terms, and integration
  access before certifying its adapter.

Required next steps: approved vendor access; verified fingerprinting/API adapter;
credentials entered through the approved secret workflow; harmless vendor test
fixtures for clear/flagged/unavailable behavior; retry/recovery verification;
and confirmation that no unverified video becomes public. Do not acquire or
use illegal content as a test fixture.

The required `aws-secrets-manager` skill is unavailable in this session. No
vendor secrets were read, created, or changed. Quarantine remains authoritative
until a real verified CSAM check passes. Mux setup is a separate integration
and is not completed by this runtime repair.
