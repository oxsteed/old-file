#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

OUT_DIR="submission/reports"
mkdir -p "$OUT_DIR"
TS="$(date +%Y%m%d_%H%M%S)"
OUT="$OUT_DIR/manual_checkpoint_${TS}.md"

python3 - <<'PY' > "$OUT"
import json
from pathlib import Path
from datetime import datetime, timezone

tracker_path = Path('submission/appstoreconnect/MANUAL_TASK_TRACKER.json')
tracker = json.loads(tracker_path.read_text()) if tracker_path.exists() else {"manual_tasks": []}
tasks = tracker.get('manual_tasks', [])

pending = [t for t in tasks if t.get('status') != 'done']
done = [t for t in tasks if t.get('status') == 'done']

print('# Manual Submission Checkpoint')
print('')
print(f"Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}")
print(f"Tracker updated: {tracker.get('last_updated_utc', '(unknown)')}")
print('')
print('## Summary')
print(f"- Completed tasks: {len(done)}")
print(f"- Remaining tasks: {len(pending)}")
print('')
print('## Task Board')
for t in tasks:
    mark = 'x' if t.get('status') == 'done' else ' '
    print(f"- [{mark}] `{t.get('id')}` — {t.get('title')}")
    print(f"  Status: `{t.get('status')}`")
    if t.get('updated_utc'):
      print(f"  Updated: `{t.get('updated_utc')}`")
    if t.get('note'):
      print(f"  Note: {t.get('note')}")
    print(f"  Artifact: `{t.get('artifact')}`")

print('')
print('## Exact Next Commands')
print('```bash')
print('cd /Users/oxsteed/Documents/build-atom')
print('./scripts/update_manual_task_tracker.sh list')
print('# Example: mark one completed task')
print('./scripts/update_manual_task_tracker.sh set asc_metadata done "Completed in ASC on <date/time>"')
print('./scripts/release_readiness_gate.sh')
print('```')

print('')
print('## Completion Condition')
print('- All tasks in `MANUAL_TASK_TRACKER.json` are `done`.')
print('- `./scripts/release_readiness_gate.sh` returns `READY_FOR_SUBMISSION=true`.')
PY

echo "$OUT"
