# Accessibility Nutrition Label Mapping (App Store Connect)

Prepared: May 31, 2026

Purpose: Help fill App Store Connect accessibility support fields cautiously.
Only claim support that has been manually verified on a real device/simulator with the feature enabled.

Apple references:
- https://developer.apple.com/help/app-store-connect/manage-app-accessibility/overview-of-accessibility-nutrition-labels/
- https://developer.apple.com/help/app-store-connect/manage-app-accessibility/manage-accessibility-nutrition-labels

## Evidence discovered in code
- User-selectable font sizing preference exists:
  - `build-atom/App/OxSteedApp.swift` (`ox.fontSizeCategory`)
- SwiftUI controls are used widely (baseline semantic accessibility benefits), but explicit `accessibilityLabel`/`accessibilityHint` coverage appears limited in current grep.

## Recommended claim posture (conservative)
Default to **do not claim** a capability until QA verifies it end-to-end.

Potentially claimable after verification:
1. Larger Text
- Candidate evidence: app-level font-size setting exists.
- Verification needed: ensure key screens remain usable with iOS Larger Text settings and/or in-app size options.

2. VoiceOver
- Verification needed: tab navigation, key actions, and major forms readable/operable with VoiceOver.

3. Reduced Motion
- Verification needed: no blocking motion effects and acceptable behavior when iOS Reduce Motion is ON.

4. Sufficient Contrast
- Verification needed: check major screens for readability in light/dark and high contrast contexts where applicable.

## Suggested manual QA matrix before claiming labels
For each candidate label:
1. Enable the accessibility feature in iOS settings.
2. Test at least these flows:
   - Sign in / account actions
   - Jobs browse + details
   - Messaging send/report/block
   - Wallet/payments overview
   - Settings privacy/delete account
3. Record pass/fail + notes in a QA log.
4. Only then mark support in App Store Connect.

## Important submission guidance
- Over-claiming accessibility support can trigger review friction if features are not actually usable.
- Under-claiming is safer than over-claiming; improve labels in subsequent updates once verified.
