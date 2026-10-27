#!/bin/sh
# VM fix 2026-10-27: Users tab can add people (useradd in sbin); marketplace counts what you already have
# (Remove works), says when a removal fails, no Set up for docs-local, paas-market import-mcp. Run as root.
set -eu
D=$(cd "$(dirname "$0")" && pwd)
[ "$(id -u)" = 0 ] || { echo "run as root"; exit 1; }
install -m 755 "$D/paas-market" /opt/paas/bin/paas-market
install -m 755 "$D/paas-user" /opt/paas/bin/paas-user
install -m 644 "$D/index.js" /opt/paas/ui-plugins/paas-market/index.js
for f in /etc/paas/users/*.env; do
  u=$(basename "$f" .env); h=$(getent passwd "$u" | cut -d: -f6)
  [ -d "$h/.claude-code-ui/plugins/paas-market" ] && cp "$D/index.js" "$h/.claude-code-ui/plugins/paas-market/index.js" && echo "updated $u"
done
# the repo copy too, so a later install-shared.sh keeps these (pass the folder that holds storage-mcp-servers)
if [ -n "${1:-}" ] && [ -d "$1/storage-mcp-servers/brain" ]; then
  B=$1/storage-mcp-servers/brain
  cp "$D/paas-market" "$B/marketplace/paas_market.py"; cp "$D/paas-user" "$B/multiuser/paas-user"
  cp "$D/index.js" "$B/ui/plugins/paas-market/index.js"; echo "repo copy updated in $B"
fi
echo "done: reload the Marketplace tab in the browser"
