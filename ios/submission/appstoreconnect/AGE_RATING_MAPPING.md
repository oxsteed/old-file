# Age Rating Questionnaire Mapping (App Store Connect)

Prepared: May 31, 2026

Purpose: Provide a conservative, evidence-based starting point for the App Store Connect age rating questionnaire. Final answers must be confirmed by product/compliance owner in App Store Connect.

## Evidence from app behavior
- User-to-user messaging exists:
  - `build-atom/Features/FeatureScreens.swift`
  - `build-atom/Networking/MessagesService.swift`
- User-generated content uploads exist (photos/videos/messages):
  - `build-atom/Features/ImagePickerView.swift`
  - `build-atom/Learn/LearnTabView.swift`
- UGC safety controls exist (report/block/moderation):
  - `build-atom/Features/FeatureScreens.swift`
  - `build-atom/Features/ContentModerator.swift`
- Real-world services payments (not gambling mechanics):
  - `build-atom/Features/FeatureScreens.swift`
  - `build-atom/Networking/MiscServices.swift`

## Recommended conservative questionnaire posture
Use this as a starting point:

1. User-generated content: **Yes**
- Reason: in-app messaging and uploads.
- Mitigations to note internally: reporting, blocking, moderation pipeline.

2. Unrestricted web access: **No**
- Reason: app is not a general-purpose browser.

3. Gambling / simulated gambling: **No**
- Reason: no betting/casino/loot box mechanics found.

4. Alcohol / tobacco / drugs references: **No explicit app feature**
- Verify final questionnaire wording before confirming.

5. Sexual content/nudity: **No explicit feature**
- But because UGC exists, choose the most accurate option Apple provides for moderated UGC exposure risk.

6. Violence/horror: **No explicit feature**
- As above, account for potential UGC exposure according to Apple questionnaire options.

7. Medical/treatment claims: **No explicit feature**

8. Mature/suggestive themes/profanity: **No explicit feature by design**
- UGC path exists; ensure this is reflected per Apple’s UGC-focused question wording.

## Reviewer note strategy
If App Review asks about rating rationale:
- State that app includes UGC messaging and attachments.
- State moderation controls (block/report + server moderation).
- State primary product scope is real-world services marketplace.

## Final owner checklist before locking age rating
1. Re-open each age-rating question in App Store Connect and answer using current Apple wording.
2. Validate that chosen answers are consistent with UGC availability in production.
3. Keep screenshots and reviewer notes consistent with selected age rating.
