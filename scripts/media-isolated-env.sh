#!/usr/bin/env bash
set -Eeuo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# A separate state directory prevents accidental reuse of an existing Credit
# verification run. The underlying harness enforces Colima and project scope.
export OXSTEED_CREDIT_TEST_STATE_DIR="${OXSTEED_MEDIA_TEST_STATE_DIR:-${TMPDIR:-/tmp}/oxsteed-media-test}"
export OXSTEED_MEDIA_TEST_MODE=true
exec bash "$ROOT_DIR/scripts/credit-isolated-env.sh" "${1:-media-test}"
