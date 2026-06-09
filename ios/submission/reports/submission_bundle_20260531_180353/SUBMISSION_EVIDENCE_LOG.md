# Submission Evidence Log (OxSteed)

Date: May 31, 2026

## Apple baseline requirements
- Source: https://developer.apple.com/news/upcoming-requirements/
- Confirmed baseline: Since April 28, 2026, uploads require Xcode 26+ and iOS 26 SDK+.

## Local build/archive evidence
- Release build: previously validated successfully.
- Archive command executed:
  - `xcodebuild -project build-atom.xcodeproj -scheme build-atom -configuration Release -destination 'generic/platform=iOS' archive -archivePath /tmp/OxSteed.xcarchive`
- Result:
  - `ARCHIVE SUCCEEDED`

## Archive metadata evidence
- Archive info plist: `/tmp/OxSteed.xcarchive/Info.plist`
- Key fields observed:
  - `CFBundleIdentifier`: `com.oxsteed.app`
  - `CFBundleShortVersionString`: `1.0.0`
  - `CFBundleVersion`: `120`
  - `Team`: `ZBRGSDRRU7`

## App icon evidence
- File: `build-atom/Assets.xcassets/AppIcon.appiconset/AppIcon.png`
- Verification output:
  - width: `1024`
  - height: `1024`
  - alpha channel: `no`

## Remaining external/manual blockers
- App Store Connect metadata entry and screenshots
- Age rating questionnaire completion
- App Privacy questionnaire final declaration alignment
- Accessibility Nutrition Labels completion
- Reviewer account credentials and final review notes entry
