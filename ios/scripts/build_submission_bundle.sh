#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

REPORT_DIR="submission/reports"
mkdir -p "$REPORT_DIR"
TS="$(date +%Y%m%d_%H%M%S)"
BUNDLE_DIR="$REPORT_DIR/submission_bundle_${TS}"
mkdir -p "$BUNDLE_DIR"

# Ensure latest gate/preflight are present
./scripts/release_readiness_gate.sh >/dev/null 2>&1 || true

LATEST_GATE=$(ls -t submission/reports/release_readiness_gate_*.txt 2>/dev/null | head -n 1 || true)
LATEST_PREFLIGHT=$(ls -t submission/reports/app_store_preflight_*.txt 2>/dev/null | head -n 1 || true)
LATEST_BRIEF=$(ls -t submission/reports/submission_brief_*.md 2>/dev/null | head -n 1 || true)
LATEST_CHECKPOINT=$(ls -t submission/reports/manual_checkpoint_*.md 2>/dev/null | head -n 1 || true)
LATEST_MANUAL_EVIDENCE=$(ls -t submission/reports/manual_evidence_validation_*.txt 2>/dev/null | head -n 1 || true)
LATEST_HISTORY="submission/reports/manual_task_history.log"

# Copy core docs
cp APP_STORE_READINESS.md "$BUNDLE_DIR/" 2>/dev/null || true
cp submission/appstoreconnect/*.md "$BUNDLE_DIR/" 2>/dev/null || true
cp submission/appstoreconnect/*.json "$BUNDLE_DIR/" 2>/dev/null || true

# Copy scripts used by operator
cp scripts/app_store_preflight.sh "$BUNDLE_DIR/" 2>/dev/null || true
cp scripts/export_app_store_ipa.sh "$BUNDLE_DIR/" 2>/dev/null || true
cp scripts/release_readiness_gate.sh "$BUNDLE_DIR/" 2>/dev/null || true
cp scripts/update_manual_task_tracker.sh "$BUNDLE_DIR/" 2>/dev/null || true
cp scripts/generate_submission_brief.sh "$BUNDLE_DIR/" 2>/dev/null || true
cp scripts/manual_checkpoint_report.sh "$BUNDLE_DIR/" 2>/dev/null || true
cp scripts/validate_manual_evidence.sh "$BUNDLE_DIR/" 2>/dev/null || true

# Copy latest reports
[[ -n "$LATEST_GATE" ]] && cp "$LATEST_GATE" "$BUNDLE_DIR/" || true
[[ -n "$LATEST_PREFLIGHT" ]] && cp "$LATEST_PREFLIGHT" "$BUNDLE_DIR/" || true
[[ -n "$LATEST_BRIEF" ]] && cp "$LATEST_BRIEF" "$BUNDLE_DIR/" || true
[[ -n "$LATEST_CHECKPOINT" ]] && cp "$LATEST_CHECKPOINT" "$BUNDLE_DIR/" || true
[[ -n "$LATEST_MANUAL_EVIDENCE" ]] && cp "$LATEST_MANUAL_EVIDENCE" "$BUNDLE_DIR/" || true
[[ -f "$LATEST_HISTORY" ]] && cp "$LATEST_HISTORY" "$BUNDLE_DIR/" || true

# Bundle index
cat > "$BUNDLE_DIR/BUNDLE_INDEX.md" <<'IDX'
# Submission Bundle Index

Generated: __GENERATED_UTC__

## Latest evidence included
- Gate report: ${LATEST_GATE:-none}
- Preflight report: ${LATEST_PREFLIGHT:-none}
- Submission brief: ${LATEST_BRIEF:-none}
- Manual checkpoint: ${LATEST_CHECKPOINT:-none}
- Manual evidence validation: ${LATEST_MANUAL_EVIDENCE:-none}
- Manual task history: __MANUAL_HISTORY__

## Recommended operator order
1. `SUBMISSION_OPERATOR_PACKET.md`
2. `MANUAL_TASK_TRACKER.json`
3. Latest `release_readiness_gate_*.txt`
4. Latest `submission_brief_*.md`
5. Run `./release_readiness_gate.sh` until `READY_FOR_SUBMISSION=true`
IDX

python3 - <<PY
from pathlib import Path
from datetime import datetime, timezone
p=Path("$BUNDLE_DIR/BUNDLE_INDEX.md")
t=p.read_text()
t=t.replace("__GENERATED_UTC__", datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC"))
t=t.replace("\${LATEST_GATE:-none}", "${LATEST_GATE:-none}")
t=t.replace("\${LATEST_PREFLIGHT:-none}", "${LATEST_PREFLIGHT:-none}")
t=t.replace("\${LATEST_BRIEF:-none}", "${LATEST_BRIEF:-none}")
t=t.replace("\${LATEST_CHECKPOINT:-none}", "${LATEST_CHECKPOINT:-none}")
t=t.replace("\${LATEST_MANUAL_EVIDENCE:-none}", "${LATEST_MANUAL_EVIDENCE:-none}")
t=t.replace("__MANUAL_HISTORY__", "${LATEST_HISTORY}" if Path("${LATEST_HISTORY}").exists() else "none")
p.write_text(t)
PY

# Zip for sharing/archival
ZIP_PATH="$REPORT_DIR/submission_bundle_${TS}.zip"
( cd "$REPORT_DIR" && zip -qr "$(basename "$ZIP_PATH")" "$(basename "$BUNDLE_DIR")" )

echo "$BUNDLE_DIR"
echo "$ZIP_PATH"
