// Marketplace backend: runs paas-market (brain/marketplace/paas_market.py) as this UI's user, so items are added to
// their own ~/.claude. Root may also set where an MCP server is (setup-mcp).
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import { execFile } from 'node:child_process';

const BIN = process.env.PAAS_MARKET_BIN || ['/opt/paas/bin/paas-market', '/usr/local/bin/paas-market'].find((p) => fs.existsSync(p)) || 'paas-market';
const ID = /^(skill|agent|mcp|plugin)\/[a-z0-9][a-z0-9_.-]{0,60}$/;
const market = (args, input) => new Promise((resolve) => {
  const p = execFile('python3', [BIN, ...args], { timeout: 120000, maxBuffer: 8 << 20, env: { ...process.env, PATH: `${process.env.HOME}/.local/bin:/usr/local/bin:${process.env.PATH}` } },
    (err, stdout, stderr) => resolve({ ok: !err, out: `${stdout}${stderr}`.trim() }));
  p.stdin.end(input || '');
});
const ids = (b) => (Array.isArray(b.ids) ? b.ids : []).filter((i) => ID.test(String(i))).slice(0, 50);

function body(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (c) => { s += c; if (s.length > 100000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch (e) { reject(e); } });
  });
}

const routes = {
  'GET /list': async () => {
    const r = await market(['list', '--json']);
    if (!r.ok) return { ok: false, out: r.out };
    return { ok: true, items: JSON.parse(r.out), root: process.getuid?.() === 0, me: os.userInfo().username };
  },
  // a personal token (MCP servers where everyone uses their own) goes on stdin, never on the command line
  'POST /add': async (b) => (ids(b).length ? market(['add', ...ids(b)], String(b.token ?? '')) : { ok: false, out: 'Nothing to add' }),
  'POST /remove': async (b) => (ids(b).length ? market(['remove', ...ids(b)]) : { ok: false, out: 'Nothing to remove' }),
  'POST /update': async () => market(['update']),
  'POST /toggle': async (b) => (ids(b).length ? market([b.on ? 'enable' : 'disable', ...ids(b)]) : { ok: false, out: 'Nothing to switch' }),
  // create a skill / agent / MCP server of your own and share it with everyone (details go on stdin, not argv)
  'POST /new': async (b) => {
    if (!['skill', 'agent', 'mcp'].includes(b.kind) || !/^[a-z0-9][a-z0-9-]{1,40}$/.test(String(b.name || ''))) return { ok: false, out: 'Name: lower-case letters, digits and dashes, e.g. vm-patching' };
    const keep = ['description', 'when', 'body', 'tools', 'model', 'url', 'token', 'token_mode'];
    return market(['new', b.kind, b.name], JSON.stringify(Object.fromEntries(keep.map((k) => [k, String(b[k] ?? '')]))));
  },
  // edit what you created: show gives the text (MCP: description + address, never the token), edit saves and re-shares it
  'POST /show': async (b) => (ID.test(String(b.id)) ? market(['show', b.id]) : { ok: false, out: 'Unknown item' }),
  'POST /edit': async (b) => {
    if (!ID.test(String(b.id))) return { ok: false, out: 'Unknown item' };
    const input = b.id.startsWith('mcp/') ? JSON.stringify({ description: String(b.description ?? ''), url: String(b.url ?? ''), token: String(b.token ?? ''), token_mode: String(b.token_mode ?? '') }) : String(b.text ?? '');
    return market(['edit', b.id], input);
  },
  'POST /unshare': async (b) => (ids(b).length ? market(['unshare', ...ids(b)]) : { ok: false, out: 'Nothing to unshare' }),
  'POST /setup-mcp': async (b) => {
    if (process.getuid?.() !== 0) return { ok: false, out: 'Only root sets up MCP servers' };
    if (!/^[a-z0-9][a-z0-9_.-]{0,60}$/.test(String(b.name || ''))) return { ok: false, out: 'Unknown server' };
    if (!['shared', 'personal', 'none'].includes(b.mode)) return { ok: false, out: 'Token: shared, personal or none' };
    return market(['setup-mcp', b.name, String(b.url || ''), b.mode], String(b.token ?? ''));
  },
};

const server = http.createServer(async (req, res) => {
  // only this user's UI may call (it sends the key it gave this process; other users on the VM cannot read it)
  if (process.env.PAAS_PLUGIN_KEY && req.headers['x-paas-key'] !== process.env.PAAS_PLUGIN_KEY) { res.writeHead(403); res.end('{"error":"forbidden"}'); return; }
  res.setHeader('Content-Type', 'application/json');
  const fn = routes[`${req.method} ${new URL(req.url, 'http://x').pathname}`];
  if (!fn) { res.writeHead(404); res.end('{"error":"not found"}'); return; }
  try { res.end(JSON.stringify(await fn(req.method === 'POST' ? await body(req) : {}))); } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: String(e.message || e) })); }
});
server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({ ready: true, port: server.address().port })));
