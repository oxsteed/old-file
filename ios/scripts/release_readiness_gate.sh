#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

TRACKER="submission/appstoreconnect/MANUAL_TASK_TRACKER.json"
REPORT_DIR="submission/reports"
mkdir -p "$REPORT_DIR"
TS="$(date +%Y%m%d_%H%M%S)"
REPORT="$REPORT_DIR/release_readiness_gate_${TS}.txt"

PASS=0
FAIL=0

ok(){ echo "[PASS] $*" | tee -a "$REPORT"; PASS=$((PASS+1)); }
bad(){ echo "[FAIL] $*" | tee -a "$REPORT"; FAIL=$((FAIL+1)); }

echo "OxSteed Unified Release Readiness Gate" > "$REPORT"
echo "Generated: $(date -u '+%Y-%m-%d %H:%M:%S UTC')" | tee -a "$REPORT"

# 1) Technical preflight
if ./scripts/app_store_preflight.sh >/tmp/ox_preflight_stdout.txt 2>&1; then
  ok "Technical preflight passed"
else
  bad "Technical preflight failed"
fi
cat /tmp/ox_preflight_stdout.txt >> "$REPORT"
LAST_PREFLIGHT=$(ls -t submission/reports/app_store_preflight_*.txt 2>/dev/null | head -n 1 || true)
if [[ -n "$LAST_PREFLIGHT" ]]; then
  echo "Latest preflight report: $LAST_PREFLIGHT" | tee -a "$REPORT"
else
  bad "No preflight report found"
fi

# 2) Manual tracker existence
if [[ -f "$TRACKER" ]]; then
  ok "Manual task tracker exists"
else
  bad "Manual task tracker missing at $TRACKER"
fi

# 2b) Manual evidence quality check
if ./scripts/validate_manual_evidence.sh >/tmp/ox_manual_evidence_stdout.txt 2>&1; then
  ok "Manual evidence validation passed"
else
  bad "Manual evidence validation failed"
fi
cat /tmp/ox_manual_evidence_stdout.txt >> "$REPORT"

# 3) Pending tasks check
if [[ -f "$TRACKER" ]]; then
  PENDING=$(python3 - <<'PY'
import json
from pathlib import Path
p=Path('submission/appstoreconnect/MANUAL_TASK_TRACKER.json')
obj=json.loads(p.read_text())
pending=[t for t in obj.get('manual_tasks',[]) if t.get('status')!='done']
print(len(pending))
for t in pending:
    print(f"- {t.get('id')}: {t.get('title')} [{t.get('status')}]")
PY
)
  COUNT=$(echo "$PENDING" | head -n 1)
  if [[ "$COUNT" == "0" ]]; then
    ok "All manual App Store Connect tasks marked done"
  else
    bad "Manual tasks still pending: $COUNT"
    echo "$PENDING" | tail -n +2 | tee -a "$REPORT"
  fi
fi

# 4) Final decision
if [[ $FAIL -eq 0 ]]; then
  echo "" | tee -a "$REPORT"
  echo "READY_FOR_SUBMISSION=true" | tee -a "$REPORT"
  echo "PASS_COUNT=$PASS" | tee -a "$REPORT"
  echo "FAIL_COUNT=$FAIL" | tee -a "$REPORT"
  echo "Report: $REPORT" | tee -a "$REPORT"
  exit 0
else
  echo "" | tee -a "$REPORT"
  echo "READY_FOR_SUBMISSION=false" | tee -a "$REPORT"
  echo "PASS_COUNT=$PASS" | tee -a "$REPORT"
  echo "FAIL_COUNT=$FAIL" | tee -a "$REPORT"
  echo "Report: $REPORT" | tee -a "$REPORT"
  exit 1
fi
