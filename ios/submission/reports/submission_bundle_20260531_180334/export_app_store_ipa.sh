#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

ARCHIVE_PATH="${1:-/tmp/OxSteed.xcarchive}"
EXPORT_PATH="${2:-/tmp/OxSteedExport}"
EXPORT_OPTIONS="/tmp/OxSteedExportOptions.plist"

cat > "$EXPORT_OPTIONS" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>app-store-connect</string>
  <key>signingStyle</key>
  <string>automatic</string>
  <key>teamID</key>
  <string>ZBRGSDRRU7</string>
  <key>destination</key>
  <string>export</string>
  <key>uploadSymbols</key>
  <true/>
  <key>manageAppVersionAndBuildNumber</key>
  <false/>
</dict>
</plist>
PLIST

rm -rf "$EXPORT_PATH"
mkdir -p "$EXPORT_PATH"

xcodebuild -exportArchive \
  -archivePath "$ARCHIVE_PATH" \
  -exportPath "$EXPORT_PATH" \
  -exportOptionsPlist "$EXPORT_OPTIONS" \
  -allowProvisioningUpdates

IPA=$(ls "$EXPORT_PATH"/*.ipa 2>/dev/null | head -n 1 || true)
if [[ -z "$IPA" ]]; then
  echo "Export failed: no IPA found in $EXPORT_PATH" >&2
  exit 1
fi

echo "Exported IPA: $IPA"
