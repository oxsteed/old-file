#!/bin/sh
set -eu

chown -R clamav:clamav /var/lib/clamav /var/log/clamav

# The database is stored in the Compose volume. Refreshing it here keeps the
# disposable CI scanner useful without depending on a Docker Hub image pull.
# FreshClam drops to its database owner itself; su adds a PAM login check
# that can reject a non-login service account before updates even start.
freshclam --stdout --user=clamav || true

exec clamd --foreground=true --config-file=/etc/clamav/clamd.conf
