#!/bin/bash
# OxSteed React Native - Archive & Upload to TestFlight
# Double-click this file to run

set -e

WORKSPACE="/Users/oxsteed/Documents/GitHub/4/mobile/ios/OxSteed.xcworkspace"
SCHEME="OxSteed"
ARCHIVE="/tmp/OxSteedRN.xcarchive"
EXPORT_PATH="/tmp/OxSteedRN-upload"
EXPORT_OPTIONS="/Users/oxsteed/Documents/GitHub/4/mobile/build_export_options.plist"
LOG_ARCHIVE="/tmp/xcode-rn-archive.log"
LOG_UPLOAD="/tmp/xcode-rn-upload.log"

echo ""
echo "======================================"
echo " OxSteed React Native → TestFlight"
echo "======================================"
echo ""

# Clean up previous
rm -rf "$ARCHIVE" "$EXPORT_PATH"

echo "Step 1/2: Archiving (5-10 min)..."
echo "Log: $LOG_ARCHIVE"
echo ""

SENTRY_DISABLE_AUTO_UPLOAD=true \
xcodebuild archive \
  -workspace "$WORKSPACE" \
  -scheme "$SCHEME" \
  -configuration Release \
  -archivePath "$ARCHIVE" \
  -allowProvisioningUpdates \
  DEVELOPMENT_TEAM=ZBRGSDRRU7 \
  CODE_SIGN_STYLE=Automatic \
  CURRENT_PROJECT_VERSION=103 \
  MARKETING_VERSION=1.0 \
  SENTRY_DISABLE_AUTO_UPLOAD=true \
  2>&1 | tee "$LOG_ARCHIVE"

ARCHIVE_EXIT=${PIPESTATUS[0]}

if [ $ARCHIVE_EXIT -ne 0 ]; then
  echo ""
  echo "ERROR: Archive failed (exit $ARCHIVE_EXIT)"
  echo "Last 30 lines of log:"
  tail -30 "$LOG_ARCHIVE"
  read -p "Press Enter to close..."
  exit 1
fi

echo ""
echo "✓ Archive succeeded!"
echo ""
echo "Step 2/2: Uploading to TestFlight..."
echo "Log: $LOG_UPLOAD"
echo ""

xcodebuild -exportArchive \
  -archivePath "$ARCHIVE" \
  -exportOptionsPlist "$EXPORT_OPTIONS" \
  -exportPath "$EXPORT_PATH" \
  -allowProvisioningUpdates \
  2>&1 | tee "$LOG_UPLOAD"

UPLOAD_EXIT=${PIPESTATUS[0]}

if [ $UPLOAD_EXIT -ne 0 ]; then
  echo ""
  echo "ERROR: Upload failed (exit $UPLOAD_EXIT)"
  tail -30 "$LOG_UPLOAD"
  read -p "Press Enter to close..."
  exit 1
fi

echo ""
echo "======================================"
echo " ✓ SUCCESS — React Native build live!"
echo "======================================"
echo ""
echo "Find it in App Store Connect → TestFlight"
echo "Apple processes it in ~15 min."
echo ""
read -p "Press Enter to close..."
