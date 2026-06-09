# Screenshot Capture Runbook (OxSteed)

Prepared: May 31, 2026

Apple references:
- Screenshot specs: https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications
- Upload guidance: https://developer.apple.com/help/app-store-connect/manage-app-information/upload-app-previews-and-screenshots/

## Target sets (minimum practical plan)
Because app supports both iPhone and iPad (`TARGETED_DEVICE_FAMILY = 1,2`), prepare:
1. iPhone screenshots
2. iPad screenshots

Recommended canonical sets for 2026 storefronts:
- iPhone 6.9" portrait set (preferred modern baseline)
- iPad 13" portrait set (or accepted iPad fallback size)

## File constraints
- Format: PNG/JPG
- Count: 1 to 10 screenshots per device family
- Orientation: Keep consistent visual story (portrait recommended for this app)

## Shot list (10 screenshots)
Use the same narrative for iPhone + iPad.

1. Home Dashboard
- Show role-aware home with stats and actions.
- Goal: communicate breadth + daily utility.

2. Job Discovery
- Jobs list/search with nearby context.
- Goal: highlight marketplace matching.

3. Job Detail / Booking Intent
- Open a specific job or booking flow.
- Goal: show actionability.

4. Messages
- Conversation view with clean thread UI.
- Goal: communication workflow.

5. Safety Controls
- Message options including report/block.
- Goal: guideline 1.2 safety posture.

6. Wallet / Payments
- Wallet summary screen.
- Goal: real-world service payment management.

7. Manage Wallet
- Stripe connect/manage state.
- Goal: payouts and operational controls.

8. Learn Experience
- Guide catalog or featured learning cards.
- Goal: education and retention value.

9. Growth Experience
- Growth tab/programs/trajectory UI.
- Goal: role expansion and business outcomes.

10. Settings Privacy Controls
- Privacy entry + export/delete account area.
- Goal: privacy/account control confidence.

## Capture setup checklist
1. Use production-like seeded account with realistic data (jobs, messages, wallet items).
2. Disable debug/placeholder elements.
3. Ensure no personal PII (real phone/email) appears in screenshots.
4. Keep locale consistent with listing language.
5. Keep status bar/time consistent across screenshots.

## Naming convention
Use predictable filenames per device family:
- `iphone69_01_home.png` ... `iphone69_10_settings_privacy.png`
- `ipad13_01_home.png` ... `ipad13_10_settings_privacy.png`

## Quality bar before upload
- No empty states unless intentionally part of narrative.
- No development banners, toasts, or error dialogs.
- Text legible at App Store thumbnail scale.
- First 3 screenshots should communicate the core value immediately.

## Submission note
If only one iPhone size is provided, ensure it matches currently accepted dimensions on Apple's screenshot specification page at upload time.
