#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

TRACKER="submission/appstoreconnect/MANUAL_TASK_TRACKER.json"

if [[ ! -f "$TRACKER" ]]; then
  echo "Tracker not found: $TRACKER" >&2
  exit 1
fi

usage() {
  cat <<USAGE
Usage:
  ./scripts/update_manual_task_tracker.sh list
  ./scripts/update_manual_task_tracker.sh set <task_id> <pending|done|blocked> [note...]
  ./scripts/update_manual_task_tracker.sh done <task_id>
  ./scripts/update_manual_task_tracker.sh pending <task_id>
USAGE
}

cmd="${1:-}"
case "$cmd" in
  list)
    python3 - <<'PY'
import json
from pathlib import Path
p=Path('submission/appstoreconnect/MANUAL_TASK_TRACKER.json')
obj=json.loads(p.read_text())
print(f"objective: {obj.get('objective')}")
print(f"last_updated_utc: {obj.get('last_updated_utc')}")
for t in obj.get('manual_tasks',[]):
    print(f"- {t.get('id')}: {t.get('title')} [{t.get('status')}]")
PY
    ;;
  set)
    task_id="${2:-}"
    status="${3:-}"
    note="${4:-}"
    if [[ -z "$task_id" || -z "$status" ]]; then
      usage; exit 1
    fi
    if [[ "$status" != "pending" && "$status" != "done" && "$status" != "blocked" ]]; then
      echo "Invalid status: $status" >&2
      exit 1
    fi
    python3 - "$task_id" "$status" "$note" <<'PY'
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

task_id=sys.argv[1]
status=sys.argv[2]
note=sys.argv[3]
p=Path('submission/appstoreconnect/MANUAL_TASK_TRACKER.json')
obj=json.loads(p.read_text())
found=False
now=datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
for t in obj.get('manual_tasks',[]):
    if t.get('id')==task_id:
        t['status']=status
        t['updated_utc']=now
        if note:
            t['note']=note
        found=True
        break
if not found:
    print(f"Task id not found: {task_id}", file=sys.stderr)
    sys.exit(1)
obj['last_updated_utc']=now
p.write_text(json.dumps(obj, indent=2)+"\n")
print(f"Updated {task_id} -> {status}")
PY
    mkdir -p submission/reports
    ts="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    {
      echo "${ts} ${task_id} -> ${status}${note:+ | note: ${note}}"
    } >> submission/reports/manual_task_history.log
    ;;
  done)
    [[ -n "${2:-}" ]] || { usage; exit 1; }
    "$0" set "$2" done
    ;;
  pending)
    [[ -n "${2:-}" ]] || { usage; exit 1; }
    "$0" set "$2" pending
    ;;
  *)
    usage
    exit 1
    ;;
esac
