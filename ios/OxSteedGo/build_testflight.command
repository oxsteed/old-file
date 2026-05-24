#!/bin/bash
# OxSteed Go - Archive & Upload to TestFlight

set -euo pipefail

ROOT="/Users/oxsteed/Documents/GitHub/4"
PROJECT="$ROOT/ios/OxSteedGo/OxSteedGo.xcodeproj"
SCHEME="OxSteedGo"
ARCHIVE="/tmp/OxSteedGoArchive.xcarchive"
EXPORT_PATH="/tmp/OxSteedGo-upload"
EXPORT_OPTIONS="$ROOT/ios/OxSteedGo/ExportOptions.testflight.plist"
LOG_ARCHIVE="/tmp/xcode-oxsteedgo-archive.log"
LOG_UPLOAD="/tmp/xcode-oxsteedgo-upload.log"

echo ""
echo "======================================"
echo " OxSteed Go -> TestFlight"
echo "======================================"
echo ""

rm -rf "$ARCHIVE" "$EXPORT_PATH"

echo "Step 1/2: Archiving OxSteed Go..."
echo "Log: $LOG_ARCHIVE"
echo ""

xcodebuild archive \
  -project "$PROJECT" \
  -scheme "$SCHEME" \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$ARCHIVE" \
  -allowProvisioningUpdates \
  DEVELOPMENT_TEAM=ZBRGSDRRU7 \
  CODE_SIGN_STYLE=Automatic \
  CURRENT_PROJECT_VERSION=107 \
  MARKETING_VERSION=1.0 \
  2>&1 | tee "$LOG_ARCHIVE"

ARCHIVE_EXIT=${PIPESTATUS[0]}
if [ "$ARCHIVE_EXIT" -ne 0 ]; then
  echo ""
  echo "ERROR: Archive failed (exit $ARCHIVE_EXIT)"
  tail -30 "$LOG_ARCHIVE"
  exit "$ARCHIVE_EXIT"
fi

echo ""
echo "Archive succeeded."
echo ""
echo "Step 2/2: Exporting and uploading to TestFlight..."
echo "Log: $LOG_UPLOAD"
echo ""

xcodebuild -exportArchive \
  -archivePath "$ARCHIVE" \
  -exportOptionsPlist "$EXPORT_OPTIONS" \
  -exportPath "$EXPORT_PATH" \
  -allowProvisioningUpdates \
  2>&1 | tee "$LOG_UPLOAD"

UPLOAD_EXIT=${PIPESTATUS[0]}
if [ "$UPLOAD_EXIT" -ne 0 ]; then
  echo ""
  echo "ERROR: Upload failed (exit $UPLOAD_EXIT)"
  tail -30 "$LOG_UPLOAD"
  echo ""
  echo "If the error is 'missingApp(bundleId: \"com.oxsteed.app\")', verify the app record in App Store Connect first:"
  echo "  Name: OxSteed"
  echo "  Bundle ID: com.oxsteed.app"
  echo "  Platform: iOS"
  echo "Then rerun this script."
  exit "$UPLOAD_EXIT"
fi

echo ""
echo "======================================"
echo " SUCCESS - OxSteed Go uploaded"
echo "======================================"
echo ""
echo "After Apple finishes processing the build, add tester:"
echo "  emilejeanphilippefr@gmail.com"
