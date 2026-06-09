#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

REPORT_DIR="$ROOT_DIR/submission/reports"
mkdir -p "$REPORT_DIR"
TS="$(date +%Y%m%d_%H%M%S)"
REPORT="$REPORT_DIR/app_store_preflight_${TS}.txt"

PASS_COUNT=0
FAIL_COUNT=0
WARN_COUNT=0

pass() { echo "[PASS] $*" | tee -a "$REPORT"; PASS_COUNT=$((PASS_COUNT+1)); }
fail() { echo "[FAIL] $*" | tee -a "$REPORT"; FAIL_COUNT=$((FAIL_COUNT+1)); }
warn() { echo "[WARN] $*" | tee -a "$REPORT"; WARN_COUNT=$((WARN_COUNT+1)); }

section() {
  echo "" | tee -a "$REPORT"
  echo "=== $* ===" | tee -a "$REPORT"
}

echo "OxSteed App Store Preflight" > "$REPORT"
echo "Generated: $(date -u '+%Y-%m-%d %H:%M:%S UTC')" | tee -a "$REPORT"
echo "Repo: $ROOT_DIR" | tee -a "$REPORT"

section "Required files"
[[ -f build-atom/Info.plist ]] && pass "Info.plist exists" || fail "Missing build-atom/Info.plist"
[[ -f build-atom/PrivacyInfo.xcprivacy ]] && pass "PrivacyInfo.xcprivacy exists" || fail "Missing build-atom/PrivacyInfo.xcprivacy"
[[ -f build-atom/OxSteed.entitlements ]] && pass "OxSteed.entitlements exists" || fail "Missing build-atom/OxSteed.entitlements"
[[ -f build-atom/Assets.xcassets/AppIcon.appiconset/AppIcon.png ]] && pass "AppIcon.png exists" || fail "Missing AppIcon.png"
[[ -f submission/appstoreconnect/METADATA_CHECKLIST.md ]] && pass "Metadata checklist exists" || fail "Missing submission metadata checklist"
[[ -f submission/appstoreconnect/APP_REVIEW_NOTES_TEMPLATE.md ]] && pass "Review notes template exists" || fail "Missing review notes template"

section "Info.plist permissions"
PERM_KEYS=(
  NSCameraUsageDescription
  NSFaceIDUsageDescription
  NSLocationWhenInUseUsageDescription
  NSMicrophoneUsageDescription
  NSPhotoLibraryUsageDescription
  NSSiriUsageDescription
  NSSpeechRecognitionUsageDescription
)
for key in "${PERM_KEYS[@]}"; do
  if /usr/libexec/PlistBuddy -c "Print :$key" build-atom/Info.plist >/dev/null 2>&1; then
    pass "$key present"
  else
    fail "$key missing"
  fi
done

if /usr/libexec/PlistBuddy -c "Print :ITSAppUsesNonExemptEncryption" build-atom/Info.plist 2>/dev/null | grep -qi "false"; then
  pass "ITSAppUsesNonExemptEncryption is false"
else
  warn "ITSAppUsesNonExemptEncryption not explicitly false"
fi

section "Privacy manifest checks"
if plutil -extract NSPrivacyTracking raw build-atom/PrivacyInfo.xcprivacy 2>/dev/null | grep -qi "^false$"; then
  pass "NSPrivacyTracking is false"
else
  fail "NSPrivacyTracking is not false or could not be parsed"
fi

for cat in NSPrivacyAccessedAPICategoryFileTimestamp NSPrivacyAccessedAPICategoryUserDefaults NSPrivacyAccessedAPICategorySystemBootTime NSPrivacyAccessedAPICategoryDiskSpace; do
  rg -q "$cat" build-atom/PrivacyInfo.xcprivacy && pass "Required reason API category present: $cat" || warn "Missing expected API category: $cat"
done

for datatype in NSPrivacyCollectedDataTypeName NSPrivacyCollectedDataTypeEmailAddress NSPrivacyCollectedDataTypePhoneNumber NSPrivacyCollectedDataTypePreciseLocation NSPrivacyCollectedDataTypePhotosorVideos NSPrivacyCollectedDataTypeUserID NSPrivacyCollectedDataTypePaymentInfo; do
  rg -q "$datatype" build-atom/PrivacyInfo.xcprivacy && pass "Data type declared: $datatype" || warn "Expected data type not found: $datatype"
done

section "App icon checks"
if command -v sips >/dev/null 2>&1; then
  WIDTH=$(sips -g pixelWidth build-atom/Assets.xcassets/AppIcon.appiconset/AppIcon.png | awk '/pixelWidth/ {print $2}')
  HEIGHT=$(sips -g pixelHeight build-atom/Assets.xcassets/AppIcon.appiconset/AppIcon.png | awk '/pixelHeight/ {print $2}')
  ALPHA=$(sips -g hasAlpha build-atom/Assets.xcassets/AppIcon.appiconset/AppIcon.png | awk '/hasAlpha/ {print $2}')

  [[ "$WIDTH" == "1024" && "$HEIGHT" == "1024" ]] && pass "App icon is 1024x1024" || fail "App icon size is ${WIDTH}x${HEIGHT}, expected 1024x1024"
  [[ "$ALPHA" == "no" ]] && pass "App icon has no alpha channel" || fail "App icon alpha should be removed"
else
  warn "sips unavailable; icon validation skipped"
fi

section "Legal/support URL liveness"
URLS=(
  "https://oxsteed.com/privacy"
  "https://oxsteed.com/terms"
  "https://oxsteed.com/contact"
)

for url in "${URLS[@]}"; do
  code=$(curl -L -s -o /dev/null -w "%{http_code}" "$url" || true)
  if [[ "$code" =~ ^2[0-9][0-9]$ || "$code" =~ ^3[0-9][0-9]$ ]]; then
    pass "$url reachable (HTTP $code)"
  else
    fail "$url not reachable (HTTP $code)"
  fi
done

section "Archive evidence"
ARCHIVE_DISTRIBUTION_OK=0
if [[ -f /tmp/OxSteed.xcarchive/Info.plist ]]; then
  pass "Archive plist exists at /tmp/OxSteed.xcarchive/Info.plist"
  BUNDLE_ID=$(plutil -p /tmp/OxSteed.xcarchive/Info.plist | awk -F '=> ' '/CFBundleIdentifier/ {gsub(/"/,"",$2); print $2; exit}')
  VERSION=$(plutil -p /tmp/OxSteed.xcarchive/Info.plist | awk -F '=> ' '/CFBundleShortVersionString/ {gsub(/"/,"",$2); print $2; exit}')
  BUILD=$(plutil -p /tmp/OxSteed.xcarchive/Info.plist | awk -F '=> ' '/CFBundleVersion/ {gsub(/"/,"",$2); print $2; exit}')
  SIGNING_ID=$(plutil -p /tmp/OxSteed.xcarchive/Info.plist | awk -F '=> ' '/SigningIdentity/ {gsub(/"/,"",$2); print $2; exit}')
  echo "Archive bundle: ${BUNDLE_ID:-unknown}" | tee -a "$REPORT"
  echo "Archive version: ${VERSION:-unknown} (${BUILD:-unknown})" | tee -a "$REPORT"
  echo "Archive signing identity: ${SIGNING_ID:-unknown}" | tee -a "$REPORT"
  if [[ "${SIGNING_ID:-}" == *"Distribution"* ]]; then
    pass "Archive uses distribution signing identity"
    ARCHIVE_DISTRIBUTION_OK=1
  else
    warn "Archive is not distribution-signed; current identity: ${SIGNING_ID:-unknown}"
  fi
else
  warn "Archive plist not found at /tmp/OxSteed.xcarchive/Info.plist"
fi

section "Exported IPA evidence"
EXPORT_IPA=$(ls /tmp/OxSteedExport/*.ipa 2>/dev/null | head -n 1 || true)
IPA_DISTRIBUTION_OK=0

if [[ -n "${EXPORT_IPA:-}" && -f "$EXPORT_IPA" ]]; then
  pass "Exported IPA exists: $EXPORT_IPA"
  TMP_DIR=$(mktemp -d)
  unzip -q "$EXPORT_IPA" -d "$TMP_DIR"
  APP_PATH=$(find "$TMP_DIR/Payload" -maxdepth 1 -type d -name "*.app" | head -n 1 || true)
  if [[ -n "${APP_PATH:-}" && -d "$APP_PATH" ]]; then
    SIGN_OUTPUT=$(codesign -dv --verbose=4 "$APP_PATH" 2>&1 || true)
    if echo "$SIGN_OUTPUT" | rg -q "Authority=Apple Distribution"; then
      pass "Exported IPA is distribution-signed"
      IPA_DISTRIBUTION_OK=1
    else
      fail "Exported IPA is not distribution-signed"
    fi
  else
    fail "Could not locate .app payload inside exported IPA"
  fi
  rm -rf "$TMP_DIR"
else
  warn "No exported IPA found at /tmp/OxSteedExport/*.ipa"
fi

if [[ $ARCHIVE_DISTRIBUTION_OK -eq 0 && $IPA_DISTRIBUTION_OK -eq 0 ]]; then
  fail "Neither archive nor exported IPA is confirmed distribution-signed"
fi

section "Summary"
echo "PASS: $PASS_COUNT" | tee -a "$REPORT"
echo "WARN: $WARN_COUNT" | tee -a "$REPORT"
echo "FAIL: $FAIL_COUNT" | tee -a "$REPORT"
echo "Report: $REPORT" | tee -a "$REPORT"

if [[ $FAIL_COUNT -gt 0 ]]; then
  exit 1
fi
