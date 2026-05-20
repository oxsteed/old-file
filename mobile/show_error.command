#!/bin/bash
echo "=== Last 80 lines of archive log ==="
tail -80 /tmp/xcode-rn-archive.log 2>/dev/null || echo "Log not found at /tmp/xcode-rn-archive.log"
echo ""
echo "=== Searching for 'error:' lines ==="
grep -i "error:" /tmp/xcode-rn-archive.log 2>/dev/null | tail -20
echo ""
echo "=== Node binary check ==="
/Applications/Codex.app/Contents/Resources/node --version 2>/dev/null || echo "Codex node not accessible"
which node 2>/dev/null || echo "no system node in PATH"
ls /opt/homebrew/bin/node 2>/dev/null || echo "no homebrew node"
ls ~/.nvm/versions/node/ 2>/dev/null | tail -3 || echo "no nvm node"
echo ""
read -p "Press Enter to close..."
