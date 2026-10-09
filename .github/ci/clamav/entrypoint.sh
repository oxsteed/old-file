#!/bin/sh
set -eu

chown -R clamav:clamav /var/lib/clamav /var/log/clamav

# The database is stored in the Compose volume. Refreshing it here keeps the
# disposable CI scanner useful without depending on a Docker Hub image pull.
su -s /bin/sh clamav -c 'freshclam --stdout' || true

exec clamd --foreground=true --config-file=/etc/clamav/clamd.conf
