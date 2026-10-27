#!/bin/sh
# Multi-user VM base (run as root, after `sh install-vm.sh` as root). Safe to re-run.
#   sh brain/multiuser/install-shared.sh
# Turns the single-user install into a shared one:
#   /opt/paas/library        the docs library, one read-only copy for everyone (root's ~/.claude/brain/library links here)
#   /opt/paas/brain          environment.md + tool-map.md shared by everyone (notes.md stays per user)
#   /opt/paas/tools, hooks   report tools and the brain's hooks
#   /opt/paas/marketplace    every skill, agent and MCP server as its own item (paas-market)
#   /opt/paas/ui             the web UI, run once per user by systemd (paas-ui@<user>, 127.0.0.1 only)
#   /etc/claude-code/        VM-wide Claude Code settings no user can override: the read-only guard and docs hooks,
#                            the brain's rules (CLAUDE.md), the API key helper, auto mode's description of the VM
#   /etc/paas                users/<user>.env (port, secrets), api-key, tls/
# Then add people with brain/multiuser/paas-user (root's Users tab in the UI does the same).
# The sign-in gate on :3001 is a separate piece (brain/multiuser/GATE-SPEC.md).
set -eu
[ "$(id -u)" = 0 ] || { echo "run as root"; exit 1; }
HERE=$(cd "$(dirname "$0")" && pwd)
BRAIN=$(cd "$HERE/.." && pwd)
P=/opt/paas
ETC=/etc/paas
RC=/root/.claude
[ -d "$RC/brain" ] || { echo "install the brain for root first: sh install-vm.sh"; exit 1; }

getent group paas-users >/dev/null || groupadd paas-users
mkdir -p "$P/bin" "$P/brain" "$ETC/users" "$ETC/tls" /etc/claude-code
chmod 755 "$P" "$P/bin" "$P/brain"; chmod 700 "$ETC/users"

# shared files: moved out of root's home once, root keeps links to them
share() {   # share <path under ~/.claude> <shared path>
  if [ -e "$RC/$1" ] && [ ! -L "$RC/$1" ]; then rm -rf "$2"; mv "$RC/$1" "$2"; fi
  [ -e "$2" ] || { [ "${3:-}" = file ] && touch "$2" || mkdir -p "$2"; }
  ln -sfn "$2" "$RC/$1"
}
share brain/library "$P/library"
share brain/environment.md "$P/brain/environment.md" file
share brain/tool-map.md "$P/brain/tool-map.md" file
rm -rf "$P/tools" "$P/hooks" "$P/banner" "$P/themes"
for d in tools hooks banner themes; do cp -R "$BRAIN/claude/$d" "$P/$d" 2>/dev/null || mkdir -p "$P/$d"; done
rm -rf "$P/plugins"; cp -R "$BRAIN/plugins" "$P/plugins"        # Claude Code plugins, offered in the marketplace
chmod -R a+rX "$P/library" "$P/brain" "$P/tools" "$P/hooks" "$P/banner" "$P/themes" "$P/plugins"
chmod 644 "$P/brain/environment.md" "$P/brain/tool-map.md"   # root edits them; everyone reads

# marketplace: the brain's skills and agents (library paths pointed at the shared copy) + the MCP catalog
install -m 755 "$BRAIN/marketplace/paas_market.py" "$P/bin/paas-market"
ln -sfn "$P/bin/paas-market" /usr/local/bin/paas-market
PAAS_MARKET="$P/marketplace" python3 "$P/bin/paas-market" publish "$BRAIN/claude" --mcp "$BRAIN/marketplace/mcp.json"
chmod -R a+rX "$P/marketplace"
# shared MCP tokens are in there: only marketplace users (and the service for other VMs, below) may look inside
getent group paas-users >/dev/null || groupadd paas-users
chgrp paas-users "$P/marketplace"; chmod 750 "$P/marketplace"

# the single-user UI service (root's, on :3001) gives way to the gate and the per-user services
systemctl --user disable --now paas-ui >/dev/null 2>&1 || true
pkill -u root -f "paas-ui/app/dist-server/server/index.js" 2>/dev/null || true
# the web UI files, the per-user plugins, the per-user service and the user tool
UI_DIR="$P/ui" UI_SHARED=1 sh "$BRAIN/ui/install-ui.sh"
rm -rf "$BRAIN/ui/plugins/paas-usage"                            # merged into Status (left over from older tars)
rm -rf "$P/ui-plugins"; cp -R "$BRAIN/ui/plugins" "$P/ui-plugins"; chmod -R a+rX "$P/ui-plugins"
install -m 644 "$HERE/paas-ui@.service" /etc/systemd/system/paas-ui@.service
install -m 755 "$HERE/paas-user" "$P/bin/paas-user"
ln -sfn "$P/bin/paas-user" /usr/local/sbin/paas-user
systemctl daemon-reload 2>/dev/null || true

# API key for everyone's Claude: root writes it once into /etc/paas/api-key (group paas-users may read it)
[ -f "$ETC/api-key" ] || { : > "$ETC/api-key"; echo "put the Anthropic API key into $ETC/api-key (one line)"; }
chown root:paas-users "$ETC/api-key"; chmod 640 "$ETC/api-key"
cat > "$P/bin/paas-api-key" <<'EOF'
#!/bin/sh
# apiKeyHelper for every user's Claude Code (managed settings): the key root keeps in /etc/paas/api-key
exec head -n1 /etc/paas/api-key
EOF
chmod 755 "$P/bin/paas-api-key"

# VM-wide Claude Code settings and rules (users cannot switch these off)
python3 "$HERE/managed_settings.py" /etc/claude-code/managed-settings.json "$P"
# the brain's rules: everyone gets their own editable ~/.claude/CLAUDE.md, started from this default (root's is its own)
sed -e "s#~/\.claude/brain/library#$P/library#g" "$BRAIN/claude/CLAUDE.md" > "$P/brain/CLAUDE.md"
rm -f /etc/claude-code/CLAUDE.md                                  # earlier versions put them VM-wide
[ -f "$RC/CLAUDE.md" ] || { [ -f "$RC/CLAUDE.md.single-user" ] && mv "$RC/CLAUDE.md.single-user" "$RC/CLAUDE.md"; }
chmod 644 /etc/claude-code/managed-settings.json "$P/brain/CLAUDE.md"

# the marketplace for other VMs: read-only HTTPS on 3443 with a token (paas-market connect https://<vm>:3443 <token> there)
getent passwd paas-market >/dev/null || useradd -r -M -d / -s /sbin/nologin paas-market
install -d -m 750 -o root -g paas-market "$ETC/market"
setfacl -m u:paas-market:rx "$P/marketplace" 2>/dev/null || echo "note: setfacl missing: the marketplace for other VMs cannot read $P/marketplace (dnf install acl)"
[ -s "$ETC/market/token" ] || { umask 077; head -c 24 /dev/urandom | base64 | tr -d '/+=' > "$ETC/market/token"; umask 022; }
[ -f "$ETC/tls/paas-ui.crt" ] && cp "$ETC/tls/paas-ui.crt" "$ETC/tls/paas-ui.key" "$ETC/market/"
chown root:paas-market "$ETC/market"/*; chmod 640 "$ETC/market"/*
install -m 755 "$HERE/paas-market-serve.py" "$P/bin/paas-market-serve"
install -m 644 "$HERE/paas-market-serve.service" /etc/systemd/system/paas-market-serve.service
if [ -f "$ETC/tls/paas-ui.crt" ]; then
  systemctl daemon-reload; systemctl enable -q paas-market-serve; systemctl restart paas-market-serve
  if command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1; then
    firewall-cmd -q --permanent --add-port=3443/tcp && firewall-cmd -q --reload
  fi
  echo "marketplace for other VMs: https://$(hostname -f 2>/dev/null || hostname):3443 (token: cat $ETC/market/token)"
else
  echo "marketplace for other VMs: starts after install-gate.sh made the certificate (re-run this script then)"
fi

# root as the first user (its UI on 127.0.0.1; the gate puts it on :3001)
"$P/bin/paas-user" add root
# an update: everyone's UI plugins, rules they never edited and default items, then their running UIs restart on the new files
"$P/bin/paas-user" provision --all >/dev/null
systemctl try-restart 'paas-ui@*' 2>/dev/null || true
echo "multi-user base installed. Next: sh brain/multiuser/install-gate.sh (https://<vm>:3001), then add people: paas-user add <name> (or root's Users tab)"
