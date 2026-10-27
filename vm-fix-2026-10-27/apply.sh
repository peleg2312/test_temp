#!/bin/sh
# VM fix 2026-10-27: Users tab can add people (useradd in sbin); marketplace counts what you already have
# (Remove works), says when a removal fails, no Set up for docs-local, paas-market import-mcp, MCP token types
# (shared / personal / none), new users without claude's first-run questions, marketplace readable by its users
# only, View / warning for people's items, removed users' shared items removed, root's settings.json env for
# everyone (keys they set win). Run as root.
set -eu
D=$(cd "$(dirname "$0")" && pwd)
[ "$(id -u)" = 0 ] || { echo "run as root"; exit 1; }
install -m 755 "$D/paas-market" /opt/paas/bin/paas-market
install -m 755 "$D/paas-user" /opt/paas/bin/paas-user
install -m 644 "$D/index.js" "$D/server.js" /opt/paas/ui-plugins/paas-market/
for f in /etc/paas/users/*.env; do
  u=$(basename "$f" .env); h=$(getent passwd "$u" | cut -d: -f6)
  [ -d "$h/.claude-code-ui/plugins/paas-market" ] && cp "$D/index.js" "$D/server.js" "$h/.claude-code-ui/plugins/paas-market/" && echo "updated $u"
done
# the repo copy too, so a later install-shared.sh keeps these (pass the folder that holds storage-mcp-servers)
if [ -n "${1:-}" ] && [ -d "$1/storage-mcp-servers/brain" ]; then
  B=$1/storage-mcp-servers/brain
  cp "$D/paas-market" "$B/marketplace/paas_market.py"; cp "$D/paas-user" "$B/multiuser/paas-user"
  cp "$D/index.js" "$D/server.js" "$B/ui/plugins/paas-market/"; echo "repo copy updated in $B"
fi
# only marketplace users (and the service for other VMs) may look inside: shared MCP tokens are there
chgrp paas-users /opt/paas/marketplace && chmod 750 /opt/paas/marketplace
if getent passwd paas-market >/dev/null; then setfacl -m u:paas-market:rx /opt/paas/marketplace || echo "note: dnf install acl, then re-run"; fi
if [ -n "${1:-}" ] && [ -d "$1/storage-mcp-servers/brain" ]; then cp "$D/install-shared.sh" "$1/storage-mcp-servers/brain/multiuser/install-shared.sh"; fi
paas-user provision --all >/dev/null && echo "everyone provisioned (no first-run questions in claude)"
systemctl try-restart 'paas-ui@*' && echo "UIs restarted"
echo "done: reload the browser page"
