#!/bin/bash
# OxSteed One (mobile3) - Archive & Upload to TestFlight
# Double-click this file to run locally on macOS with Xcode installed.

set -e

WORKSPACE="/Users/oxsteed/Documents/GitHub/4/mobile3/ios/OxSteedOne.xcworkspace"
SCHEME="OxSteedOne"
ARCHIVE="/tmp/OxSteedOne.xcarchive"
EXPORT_PATH="/tmp/OxSteedOne-upload"
EXPORT_OPTIONS="/Users/oxsteed/Documents/GitHub/4/mobile3/build_export_options.plist"
LOG_ARCHIVE="/tmp/xcode-one-archive.log"
LOG_UPLOAD="/tmp/xcode-one-upload.log"

echo ""
echo "======================================"
echo " OxSteed One (mobile3) -> TestFlight"
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
  CURRENT_PROJECT_VERSION=2 \
  MARKETING_VERSION=1.0.0 \
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
echo "Archive succeeded. Verifying main.jsbundle is embedded..."
if [ -f "$ARCHIVE/Products/Applications/OxSteedOne.app/main.jsbundle" ]; then
  echo "OK: main.jsbundle is inside OxSteedOne.app"
else
  echo "WARNING: main.jsbundle missing from OxSteedOne.app - native launch will fail."
  find "$ARCHIVE/Products/Applications/OxSteedOne.app" -maxdepth 3 -name '*.jsbundle' -print
fi
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
echo " SUCCESS - OxSteed One uploaded to TestFlight"
echo "======================================"
