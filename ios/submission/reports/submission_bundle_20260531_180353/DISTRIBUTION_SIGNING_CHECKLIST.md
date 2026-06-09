# Distribution Signing Checklist (App Store Upload)

Prepared: May 31, 2026

Why this exists:
- Current local preflight reports the archive is signed with an Apple Development identity.
- App Store upload requires distribution signing for submission archives.

Apple references:
- https://developer.apple.com/help/account/provisioning-profiles/create-an-app-store-provisioning-profile
- https://developer.apple.com/help/account/certificates/certificates-overview/

## Target end state
A new archive where `SigningIdentity` in archive `Info.plist` is distribution-signed (for example, Apple Distribution / iOS Distribution depending on Xcode/account setup).

## Steps in Xcode
1. Open target `build-atom` -> Signing & Capabilities.
2. Ensure correct Team is selected.
3. Use automatic signing for distribution upload flow, or select an App Store Connect distribution profile manually.
4. Confirm bundle identifier is final (`com.oxsteed.app`).
5. Re-archive in Release.

## Verify after archive
Run:

```bash
cd /Users/oxsteed/Documents/build-atom
./scripts/app_store_preflight.sh
```

Pass condition:
- Preflight summary shows `FAIL: 0`
- Archive section reports distribution signing identity.

## Evidence file
Keep the generated report in:
- `submission/reports/`

Use that report as part of submission sign-off.
