# Media location recovery and consistency

## Changes

- Desktop, tablet, and phone location controls share the same neighborhood state. Desktop guests can also choose a location.
- Profile city/region is displayed when available. Explicit city/region and All-location URLs update an already mounted Media shell.
- The neighborhood provider is the single writer of location URL parameters and preserves unrelated filters.
- Pending device, reverse-geocode, and city lookups cannot overwrite a newer selection.
- Device-location errors distinguish denied permission, unavailable position, timeout, and unsupported browsers. Manual retry remains available; failed requests are not cached indefinitely.
- Concurrent geolocation requests share a pending lookup; successful results expire after ten minutes.
- Permission prompts remain user-initiated. Browser/OS permission restrictions and unavailable desktop positioning still require user action or manual city entry.
- Missing Media recovery, verification, Space suggestion, and profile-preview strings are present in both catalogs for all five languages.
- The locale shard size guard increases from 512 to 528 KiB to accommodate Arabic recovery translations; three shards per language remain enforced.

## Verification

Run from `client`:

- `node --test scripts/browserLocation.test.mjs`: 4 tests passed.
- `node --test scripts/mediaLocation.browser-check.cjs`: browser regression passed with synthetic responses and no production writes.
- `npm run verify:i18n`: passed, including static key resolution and locale parity.
- `npm run build:ci`: passed, including prebuild checks and verification of 771 emitted assets.

The helper tests are included in `test:media-accessibility`. The browser regression requires locally installed Chrome and is runnable separately.

These checks establish local behavior and build validity, not successful production deployment or desktop OS location availability.
