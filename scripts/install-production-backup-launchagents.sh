#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

# launchd cannot read the repository while it is protected by macOS Documents
# privacy controls. Install a reviewed copy in the user's application-support
# directory and keep the repository templates as the source of truth.

export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"
REPOSITORY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_ROOT="${OXSTEED_BACKUP_AGENT_ROOT:-$HOME/Library/Application Support/OxSteed/production-backup}"
LAUNCH_AGENTS_ROOT="$HOME/Library/LaunchAgents"
uid="$(id -u)"

mkdir -p "$INSTALL_ROOT" "$LAUNCH_AGENTS_ROOT"
chmod 700 "$INSTALL_ROOT" "$LAUNCH_AGENTS_ROOT"
install -m 700 "$REPOSITORY_ROOT/scripts/backup-coolify-production.sh" "$INSTALL_ROOT/backup-coolify-production.sh"
install -m 700 "$REPOSITORY_ROOT/scripts/check-production-backup.sh" "$INSTALL_ROOT/check-production-backup.sh"
install -m 600 "$REPOSITORY_ROOT/scripts/com.oxsteed.production-backup.plist" "$LAUNCH_AGENTS_ROOT/com.oxsteed.production-backup.plist"
install -m 600 "$REPOSITORY_ROOT/scripts/com.oxsteed.production-backup-monitor.plist" "$LAUNCH_AGENTS_ROOT/com.oxsteed.production-backup-monitor.plist"

plutil -lint "$LAUNCH_AGENTS_ROOT/com.oxsteed.production-backup.plist" >/dev/null
plutil -lint "$LAUNCH_AGENTS_ROOT/com.oxsteed.production-backup-monitor.plist" >/dev/null
launchctl bootout "gui/$uid/com.oxsteed.production-backup" 2>/dev/null || true
launchctl bootout "gui/$uid/com.oxsteed.production-backup-monitor" 2>/dev/null || true
launchctl bootstrap "gui/$uid" "$LAUNCH_AGENTS_ROOT/com.oxsteed.production-backup.plist"
launchctl bootstrap "gui/$uid" "$LAUNCH_AGENTS_ROOT/com.oxsteed.production-backup-monitor.plist"
printf 'Installed OxSteed backup LaunchAgents from %s into %s\n' "$REPOSITORY_ROOT" "$INSTALL_ROOT"
