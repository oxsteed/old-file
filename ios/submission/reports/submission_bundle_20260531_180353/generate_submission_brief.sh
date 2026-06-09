#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

OUT_DIR="submission/reports"
mkdir -p "$OUT_DIR"
TS="$(date +%Y%m%d_%H%M%S)"
OUT="$OUT_DIR/submission_brief_${TS}.md"

LATEST_GATE=$(ls -t submission/reports/release_readiness_gate_*.txt 2>/dev/null | head -n 1 || true)
LATEST_PREFLIGHT=$(ls -t submission/reports/app_store_preflight_*.txt 2>/dev/null | head -n 1 || true)

python3 - <<'PY' > "$OUT"
import json
from pathlib import Path
from datetime import datetime, timezone

tracker = Path('submission/appstoreconnect/MANUAL_TASK_TRACKER.json')
obj = json.loads(tracker.read_text()) if tracker.exists() else {"manual_tasks": []}
manual = obj.get('manual_tasks', [])
pending = [t for t in manual if t.get('status') != 'done']

def line(s=""):
    print(s)

line('# Submission Brief')
line('')
line(f'Generated: {datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")}')
line('')
line('## Readiness Snapshot')
line(f'- Objective: {obj.get("objective", "(missing)")}')
line(f'- Tracker last updated: {obj.get("last_updated_utc", "(unknown)")}')
line(f'- Pending manual tasks: {len(pending)}')
line('')
line('## Immediate Next Actions')
if not pending:
    line('1. Re-run unified gate and submit for review if `READY_FOR_SUBMISSION=true`.')
else:
    for i, t in enumerate(pending, 1):
        line(f'{i}. `{t.get("id")}` — {t.get("title")}')
        line(f'   - Artifact: `{t.get("artifact")}`')
line('')
line('## Operator Commands')
line('```bash')
line('cd /Users/oxsteed/Documents/build-atom')
line('./scripts/update_manual_task_tracker.sh list')
line('# Mark a task done')
line('./scripts/update_manual_task_tracker.sh done <task_id>')
line('# Re-check go/no-go')
line('./scripts/release_readiness_gate.sh')
line('```')
PY

{
  echo ""
  echo "## Latest Evidence Files"
  echo "- Gate report: ${LATEST_GATE:-none}"
  echo "- Preflight report: ${LATEST_PREFLIGHT:-none}"
} >> "$OUT"

echo "$OUT"
