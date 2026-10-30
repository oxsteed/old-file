#!/bin/sh
set -eu

# Keep preparation fail-closed, then replace the shell with the long-lived app.
# dumb-init must supervise Node directly throughout its graceful shutdown.
node scripts/prepare-runtime-schema.cjs
node scripts/sync-web-assets.cjs
exec node index.js
