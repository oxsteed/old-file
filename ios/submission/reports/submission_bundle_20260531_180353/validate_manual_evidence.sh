#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

TRACKER="submission/appstoreconnect/MANUAL_TASK_TRACKER.json"
OUT_DIR="submission/reports"
mkdir -p "$OUT_DIR"
TS="$(date +%Y%m%d_%H%M%S)"
OUT="$OUT_DIR/manual_evidence_validation_${TS}.txt"

PASS=0
FAIL=0

ok(){ echo "[PASS] $*" | tee -a "$OUT"; PASS=$((PASS+1)); }
bad(){ echo "[FAIL] $*" | tee -a "$OUT"; FAIL=$((FAIL+1)); }

echo "Manual Evidence Validation" > "$OUT"
echo "Generated: $(date -u '+%Y-%m-%d %H:%M:%S UTC')" | tee -a "$OUT"

if [[ ! -f "$TRACKER" ]]; then
  bad "Tracker missing: $TRACKER"
  echo "FAIL_COUNT=$FAIL" | tee -a "$OUT"
  exit 1
fi
ok "Tracker exists"

python3 - <<'PY' > /tmp/manual_evidence_check.json
import json, re
from pathlib import Path
p=Path('submission/appstoreconnect/MANUAL_TASK_TRACKER.json')
obj=json.loads(p.read_text())
results=[]
for t in obj.get('manual_tasks',[]):
    status=t.get('status')
    note=t.get('note','')
    updated=t.get('updated_utc','')
    tid=t.get('id')
    title=t.get('title')
    artifact=t.get('artifact')
    rec={"id":tid,"title":title,"status":status,"artifact":artifact,"has_note":bool(note.strip()),"has_updated":bool(updated.strip())}
    results.append(rec)
print(json.dumps(results))
PY

python3 - <<'PY' | tee -a "$OUT"
import json
from pathlib import Path
arr=json.loads(Path('/tmp/manual_evidence_check.json').read_text())
for r in arr:
    print(f"TASK {r['id']} status={r['status']} note={r['has_note']} updated={r['has_updated']} artifact={r['artifact']}")
PY

# shell-level checks
DONE_IDS=$(python3 - <<'PY'
import json
from pathlib import Path
arr=json.loads(Path('/tmp/manual_evidence_check.json').read_text())
print('\n'.join([r['id'] for r in arr if r['status']=='done']))
PY
)

if [[ -z "${DONE_IDS:-}" ]]; then
  ok "No tasks marked done yet; evidence-note requirement deferred"
else
  while IFS= read -r id; do
    HAS_NOTE=$(python3 - <<PY
import json
from pathlib import Path
arr=json.loads(Path('/tmp/manual_evidence_check.json').read_text())
for r in arr:
    if r['id']=='$id':
        print('1' if r['has_note'] else '0')
        break
PY
)
    HAS_UPDATED=$(python3 - <<PY
import json
from pathlib import Path
arr=json.loads(Path('/tmp/manual_evidence_check.json').read_text())
for r in arr:
    if r['id']=='$id':
        print('1' if r['has_updated'] else '0')
        break
PY
)
    if [[ "$HAS_NOTE" == "1" && "$HAS_UPDATED" == "1" ]]; then
      ok "Done task $id has note + updated_utc evidence"
    else
      bad "Done task $id missing note or updated_utc evidence"
    fi
  done <<< "$DONE_IDS"
fi

# artifacts existence check for all tasks
python3 - <<'PY' >/tmp/manual_artifacts.txt
import json
from pathlib import Path
arr=json.loads(Path('/tmp/manual_evidence_check.json').read_text())
for r in arr:
    print(r['id'] + '|' + (r.get('artifact') or ''))
PY

while IFS='|' read -r id artifact; do
  if [[ -n "$artifact" && -e "$artifact" ]]; then
    ok "Artifact exists for $id: $artifact"
  else
    bad "Artifact missing for $id: $artifact"
  fi
done < /tmp/manual_artifacts.txt

echo "PASS_COUNT=$PASS" | tee -a "$OUT"
echo "FAIL_COUNT=$FAIL" | tee -a "$OUT"
echo "Report: $OUT" | tee -a "$OUT"

if [[ $FAIL -gt 0 ]]; then
  exit 1
fi
