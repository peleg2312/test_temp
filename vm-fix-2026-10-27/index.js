// Marketplace tab: search the VM's skills, agents and MCP servers; add / remove / update them for yourself (data: server.js).
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const KIND = { skill: 'Skill', agent: 'Agent', mcp: 'MCP server', plugin: 'Plugin' };

const CSS = `
.mk{font:14px/1.5 Inter,ui-sans-serif,system-ui,sans-serif;color:hsl(var(--foreground));padding:28px;max-width:1100px;margin:0 auto}
.mk h2{font-size:22px;font-weight:700;margin:0}.mk .sub{color:hsl(var(--muted-foreground));font-size:13px}
.mk .row{display:flex;gap:10px;flex-wrap:wrap;align-items:center;justify-content:space-between}
.mk .bar{margin:18px 0 14px}
.mk input.q{flex:1 1 280px;background:hsl(var(--background));border:1px solid hsl(var(--border));border-radius:10px;padding:8px 12px;color:inherit;font:inherit}
.mk .seg{display:inline-flex;border:1px solid hsl(var(--border));border-radius:10px;overflow:hidden}
.mk .seg button{padding:7px 14px;background:none;border:0;color:hsl(var(--muted-foreground));cursor:pointer;font:inherit}
.mk .seg button.on{background:hsl(var(--accent));color:hsl(var(--foreground));font-weight:600}
.mk .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px}
.mk .item{border:1px solid hsl(var(--border));border-radius:12px;padding:12px 14px;background:hsl(var(--card));display:flex;flex-direction:column;gap:6px}
.mk .item.have{border-color:rgba(124,58,237,.45)}
.mk .t{font-weight:600}.mk .d{color:hsl(var(--muted-foreground));font-size:13px;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
.mk .tag{display:inline-block;font-size:11px;padding:1px 8px;border-radius:999px;background:hsl(var(--accent));color:hsl(var(--muted-foreground));margin-right:6px}
.mk .tag.have{background:rgba(124,58,237,.15);color:#7c3aed}.mk .tag.upd{background:rgba(217,119,6,.15);color:#d97706}
.mk .acts{display:flex;gap:6px;margin-top:auto;padding-top:4px;flex-wrap:wrap}
.mk .go{border:0;border-radius:999px;padding:5px 16px;font:600 12.5px/1.4 inherit;cursor:pointer;color:#0b0d1a;background:linear-gradient(90deg,#a78bfa,#60a5fa,#22d3ee)}
.mk .ghost{border:1px solid hsl(var(--border));background:none;color:inherit;border-radius:999px;padding:4px 14px;font:500 12.5px/1.4 inherit;cursor:pointer}
.mk button:disabled{opacity:.5;cursor:default}
.mk .setup{display:grid;gap:6px;margin-top:6px}.mk .setup input{background:hsl(var(--background));border:1px solid hsl(var(--border));border-radius:8px;padding:6px 10px;color:inherit;font:13px inherit}
.mk .nf{margin:14px 0;padding:18px 20px;gap:14px}
.mk .types{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.mk .types button{text-align:left;border:1px solid hsl(var(--border));border-radius:10px;background:hsl(var(--background));color:inherit;padding:10px 12px;cursor:pointer;font:inherit}
.mk .types button b{display:block;font-size:13.5px}.mk .types button span{color:hsl(var(--muted-foreground));font-size:12px}
.mk .types button.on{border-color:#8b5cf6;background:rgba(124,58,237,.12);box-shadow:0 0 0 1px #8b5cf6}
.mk .fields{display:grid;grid-template-columns:1fr 2fr;gap:12px}
.mk label,.mk .lbl{display:flex;flex-direction:column;gap:5px;font-size:12px;font-weight:600;color:hsl(var(--muted-foreground))}
.mk label.wide,.mk .lbl.wide{grid-column:1/-1}
.mk .nf input,.mk .nf textarea{background:hsl(var(--background));border:1px solid hsl(var(--border));border-radius:8px;padding:8px 11px;color:hsl(var(--foreground));font:400 13.5px/1.45 Inter,ui-sans-serif,system-ui,sans-serif;width:100%;box-sizing:border-box}
.mk .nf input::placeholder,.mk .nf textarea::placeholder{color:hsl(var(--muted-foreground));opacity:.6}
.mk .nf textarea{font:12.5px/1.55 ui-monospace,Menlo,monospace;resize:vertical;min-height:150px}
.mk .nf input:focus,.mk .nf textarea:focus{outline:none;border-color:#8b5cf6;box-shadow:0 0 0 3px rgba(124,58,237,.2)}
.mk .nf .acts{padding-top:0}.mk .nst{color:#f87171}
.mk .tm{display:flex;gap:6px;flex-wrap:wrap}.mk .tm button{border:1px solid hsl(var(--border));background:hsl(var(--background));color:inherit;border-radius:8px;padding:5px 10px;font:500 12.5px/1.4 inherit;cursor:pointer}
.mk .tm button.on{border-color:#8b5cf6;background:rgba(124,58,237,.12)}
.mk .empty{padding:36px;text-align:center;color:hsl(var(--muted-foreground))}
@media (max-width:640px){.mk{padding:16px}.mk .grid,.mk .fields,.mk .types{grid-template-columns:1fr}}`;

export function mount(container, api) {
  let items = [];
  let root = false;
  let me = '';
  let kind = 'all';
  container.innerHTML = `<style>${CSS}</style><div class="mk"><div class="row"><div><h2>Marketplace</h2>
    <div class="sub">Skills, agents, MCP servers and plugins on this VM. Add what you need: it goes into your own Claude only.</div></div>
    <div style="display:flex;gap:8px"><button class="ghost upd-all" style="display:none">Update all</button><button class="go new">+ New</button></div></div>
    <div class="newform"></div>
    <div class="row bar"><input class="q" type="search" placeholder="Search: ontap, latency, zoning, capacity…">
    <div class="seg">${[['all', 'All'], ['skill', 'Skills'], ['agent', 'Agents'], ['mcp', 'MCP servers'], ['plugin', 'Plugins'], ['have', 'Added']].map(([v, l]) => `<button data-k="${v}" class="${v === kind ? 'on' : ''}">${l}</button>`).join('')}</div></div>
    <div class="grid"><div class="empty">Loading…</div></div></div>`;
  const grid = container.querySelector('.grid');
  const q = container.querySelector('.q');
  const updAll = container.querySelector('.upd-all');

  async function load() {
    const r = await api.rpc('GET', 'list').catch((e) => ({ ok: false, out: String(e.message || e) }));
    if (!r.ok) { grid.innerHTML = `<div class="empty">${esc(r.out)}</div>`; return; }
    items = r.items; root = r.root; me = r.me;
    const n = items.filter((i) => i.update).length;
    updAll.style.display = n ? '' : 'none';
    updAll.textContent = `Update all (${n})`;
    render();
  }

  function render() {
    const words = q.value.toLowerCase().split(/\s+/).filter(Boolean);
    const shown = items.filter((i) => (kind === 'all' || (kind === 'have' ? i.added || (i.author && i.author === me) : i.kind === kind))
      && words.every((w) => `${i.name} ${i.description} ${KIND[i.kind]}`.toLowerCase().includes(w)));
    grid.innerHTML = shown.map((i) => { const mine = i.author && i.author === me; return `<div class="item${i.added || mine ? ' have' : ''}" data-id="${esc(i.id)}">
      <div><span class="tag">${KIND[i.kind]}</span>${mine ? '<span class="tag have">yours</span>' : i.author ? `<span class="tag">by ${esc(i.author)}</span>` : ''}${i.added ? '<span class="tag have">added</span>' : ''}${i.added && i.kind === 'plugin' && !i.enabled ? '<span class="tag upd">off</span>' : ''}${i.update ? '<span class="tag upd">update</span>' : ''}${i.ready ? '' : '<span class="tag upd">not set up</span>'}${i.token_mode === 'personal' ? '<span class="tag">own token</span>' : ''}${i.risky ? `<span class="tag upd" title="${esc(i.risky)}">runs commands</span>` : ''}</div>
      <div class="t">${i.kind === 'skill' ? '/' : ''}${esc(i.name)}</div><div class="d" title="${esc(i.description)}">${esc(i.description)}</div>
      <div class="acts">${mine ? '<button class="ghost" data-a="edit">Edit</button><button class="ghost" data-a="unshare">Unshare</button>'
        : `${i.added && i.kind === 'plugin' ? `<button class="ghost" data-a="toggle" data-on="${i.enabled ? 0 : 1}">${i.enabled ? 'Turn off' : 'Turn on'}</button>` : ''}${i.added ? `<button class="ghost" data-a="remove">Remove</button>${i.update ? '<button class="go" data-a="add">Update</button>' : ''}`
        : i.ready ? '<button class="go" data-a="add">Add</button>' : `<span class="sub">${root ? '' : 'Root sets its address first'}</span>`}
        ${root && i.kind === 'mcp' && !i.author && !i.local ? '<button class="ghost" data-a="setup">Set up</button>' : ''}
        ${i.kind !== 'plugin' ? '<button class="ghost" data-a="view">View</button>' : ''}`}</div>
    </div>`; }).join('') || `<div class="empty">${items.length ? 'Nothing matches' : 'The marketplace is empty'}</div>`;
    grid.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => act(b.closest('.item'), b.dataset.a, b)));
  }

  async function act(card, a, btn) {
    const id = card.dataset.id;
    const it = items.find((x) => x.id === id) || {};
    if (a === 'setup') {
      if (card.querySelector('.setup')) return;
      let mode = it.token_mode === 'none' || it.token_mode === 'personal' ? it.token_mode : 'shared';
      card.insertAdjacentHTML('beforeend', `<div class="setup"><input class="u" placeholder="http://host:8000/mcp" value="${esc(it.url || '')}">
        <div class="tm">${[['shared', 'One token for everyone'], ['personal', 'Each person their own'], ['none', 'No token']].map(([m, l]) => `<button type="button" data-m="${m}">${l}</button>`).join('')}</div>
        <input class="tk" type="password" placeholder="The token everyone uses">
        <div class="acts"><button class="go s">Save</button><span class="sub st"></span></div></div>`);
      const tk = card.querySelector('.tk');
      const pick = () => { card.querySelectorAll('.tm button').forEach((x) => x.classList.toggle('on', x.dataset.m === mode)); tk.style.display = mode === 'shared' ? '' : 'none'; };
      card.querySelectorAll('.tm button').forEach((x) => x.addEventListener('click', () => { mode = x.dataset.m; pick(); }));
      pick();
      card.querySelector('.s').addEventListener('click', async () => {
        const r = await api.rpc('POST', 'setup-mcp', { name: id.split('/')[1], url: card.querySelector('.u').value.trim(), mode, token: mode === 'shared' ? tk.value.trim() : '' })
          .catch((e) => ({ out: String(e.message || e) }));
        if (!r.ok) { card.querySelector('.st').textContent = r.out; return; }
        load();
      });
      return;
    }
    if (a === 'add' && it.token_mode === 'personal' && !it.added) {
      if (card.querySelector('.setup')) return;
      card.insertAdjacentHTML('beforeend', `<div class="setup"><input class="ptk" type="password" placeholder="Your own token (optional)">
        <div class="acts"><button class="go pa">Add</button><span class="sub st"></span></div></div>`);
      card.querySelector('.ptk').focus();
      card.querySelector('.pa').addEventListener('click', async (e) => {
        e.target.disabled = true;
        const r = await api.rpc('POST', 'add', { ids: [id], token: card.querySelector('.ptk').value.trim() }).catch((x) => ({ out: String(x.message || x) }));
        e.target.disabled = false;
        if (!r.ok) { card.querySelector('.st').textContent = r.out; return; }
        load();
      });
      return;
    }
    if (a === 'edit') { editForm(id); return; }
    if (a === 'view') {
      const v = await api.rpc('POST', 'view', { id }).catch((e) => ({ out: String(e.message || e) }));
      slot.innerHTML = `<div class="item nf"><div><div class="t">${esc(id)}${it.author ? ` <span class="sub">shared by ${esc(it.author)}</span>` : ''}</div>
        ${it.risky ? `<div class="sub" style="color:#d97706">Runs commands or uses tools without asking (${esc(it.risky)}): read it before you add it.</div>` : ''}</div>
        <textarea class="ex" rows="18" readonly spellcheck="false"></textarea><div class="acts"><button class="ghost ec">Close</button></div></div>`;
      slot.querySelector('.ex').value = v.ok ? v.out : v.out || 'Could not read it';
      slot.querySelector('.ec').addEventListener('click', () => { slot.innerHTML = ''; });
      slot.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (a === 'add' && it.author && it.author !== me && !window.confirm(`${id} was shared by ${it.author}${it.risky ? ` and runs commands or uses tools without asking (${it.risky})` : ''}. It works with your permissions. Add it?`)) return;
    if (a === 'unshare' && !window.confirm(`Take ${id} out of the marketplace? People who added it keep their copy.`)) return;
    btn.disabled = true;
    const r = await api.rpc('POST', a, { ids: [id], on: btn.dataset.on === '1' }).catch((e) => ({ out: String(e.message || e) }));
    if (!r.ok) window.alert(r.out);
    await load();
  }

  const slot = container.querySelector('.newform');
  function newForm() {
    slot.innerHTML = `<div class="item nf"><div><div class="t">New for everyone</div>
      <div class="sub">Added to your own Claude and shared in the marketplace, where everyone can add it.</div></div>
      <div class="types">${[['skill', 'Skill', 'A playbook Claude follows'], ['agent', 'Agent', 'A helper Claude hands tasks to'], ['mcp', 'MCP server', 'A live data source']]
        .map(([k, t, d]) => `<button type="button" data-t="${k}" class="${k === 'skill' ? 'on' : ''}"><b>${t}</b><span>${d}</span></button>`).join('')}</div>
      <div class="fields">
        <label>Name<input class="nn" placeholder="e.g. vm-patching"></label>
        <label>Description<input class="nd" placeholder="What it does and when to use it"></label>
        <label class="wide f-skill"><span>Trigger phrases <i style="font-weight:400">(optional)</i></span><input class="nw" placeholder="e.g. patch the vms, vm patching"></label>
        <label class="f-agent"><span>Tools <i style="font-weight:400">(optional)</i></span><input class="nt" placeholder="e.g. Read, Grep, Bash"></label>
        <label class="f-agent"><span>Model <i style="font-weight:400">(optional)</i></span><input class="nm" placeholder="sonnet, opus or haiku (default: same as yours)"></label>
        <label class="f-mcp">Address<input class="nu" placeholder="http://host:8000/mcp"></label>
        <div class="lbl wide f-mcp">Token<div class="tm ntm">${[['shared', 'One token for everyone'], ['personal', 'Each person their own'], ['none', 'No token']].map(([m, l]) => `<button type="button" data-m="${m}">${l}</button>`).join('')}</div></div>
        <label class="wide f-mcp f-tok"><span class="ntl">The token everyone uses</span><input class="ntk" type="password"></label>
        <label class="wide f-body">Instructions (Markdown)<textarea class="nb" rows="8" placeholder="Steps, commands, checks, what to report"></textarea></label>
      </div>
      <div class="acts"><button class="go ns">Create and share</button><button class="ghost nc">Cancel</button><span class="sub nst"></span></div></div>`;
    let nk = 'skill';
    let ntm = 'shared';
    const tokLabel = { shared: 'The token everyone uses', personal: 'Your own token (optional, only you use it)' };
    const tmVis = () => {
      slot.querySelectorAll('.ntm button').forEach((x) => x.classList.toggle('on', x.dataset.m === ntm));
      slot.querySelector('.f-tok').style.display = nk === 'mcp' && ntm !== 'none' ? '' : 'none';
      slot.querySelector('.ntl').textContent = tokLabel[ntm] || '';
    };
    const v = (c) => slot.querySelector(c).value;
    const kindVis = () => {
      const show = { skill: ['f-skill', 'f-body'], agent: ['f-agent', 'f-body'], mcp: ['f-mcp'] }[nk];
      slot.querySelectorAll('.f-skill,.f-agent,.f-mcp,.f-body').forEach((el) => { el.style.display = show.some((c) => el.classList.contains(c)) ? '' : 'none'; });
      slot.querySelectorAll('.types button').forEach((x) => x.classList.toggle('on', x.dataset.t === nk));
    };
    slot.querySelectorAll('.types button').forEach((x) => x.addEventListener('click', () => { nk = x.dataset.t; kindVis(); tmVis(); }));
    slot.querySelectorAll('.ntm button').forEach((x) => x.addEventListener('click', () => { ntm = x.dataset.m; tmVis(); }));
    kindVis();
    tmVis();
    slot.querySelector('.nn').focus();
    slot.querySelector('.nc').addEventListener('click', () => { slot.innerHTML = ''; });
    slot.querySelector('.ns').addEventListener('click', async (e) => {
      e.target.disabled = true;
      const r = await api.rpc('POST', 'new', { kind: nk, name: v('.nn').trim(), description: v('.nd'), when: v('.nw'), tools: v('.nt'),
        model: v('.nm').trim(), url: v('.nu').trim(), token: ntm === 'none' ? '' : v('.ntk').trim(), token_mode: ntm, body: v('.nb') }).catch((x) => ({ out: String(x.message || x) }));
      e.target.disabled = false;
      if (!r.ok) { slot.querySelector('.nst').textContent = r.out; return; }
      slot.innerHTML = '';
      load();
    });
  }
  async function editForm(id) {
    const r = await api.rpc('POST', 'show', { id }).catch((e) => ({ out: String(e.message || e) }));
    if (!r.ok) { window.alert(r.out); return; }
    const mcp = id.startsWith('mcp/');
    const m = mcp ? JSON.parse(r.out) : null;
    slot.innerHTML = `<div class="item nf"><div><div class="t">Edit ${esc(id.replace('skill/', '/').replace(/^(agent|mcp)\//, ''))}</div>
      <div class="sub">Saved to your own Claude and to the marketplace. People who added it see an update.</div></div>
      <div class="fields">${mcp ? `
        <label class="wide">Description<input class="ed" value="${esc(m.description)}"></label>
        <label>Address<input class="eu" value="${esc(m.url)}"></label>
        <div class="lbl wide">Token<div class="tm etm">${[['shared', 'One token for everyone'], ['personal', 'Each person their own'], ['none', 'No token']].map(([m, l]) => `<button type="button" data-m="${m}">${l}</button>`).join('')}</div></div>
        <label class="e-tok"><span>Token <i style="font-weight:400">(${m.has_token ? 'blank keeps the current one' : 'optional'})</i></span><input class="et" type="password"></label>`
        : '<label class="wide">The file: header (name, description) between the --- lines, then the instructions<textarea class="ex" rows="18" spellcheck="false"></textarea></label>'}
      </div>
      <div class="acts"><button class="go es">Save</button><button class="ghost ec">Cancel</button><span class="sub nst"></span></div></div>`;
    if (!mcp) slot.querySelector('.ex').value = r.out;
    let etm = mcp ? m.token_mode : '';
    const etmVis = () => {
      slot.querySelectorAll('.etm button').forEach((x) => x.classList.toggle('on', x.dataset.m === etm));
      const t = slot.querySelector('.e-tok'); if (t) t.style.display = etm === 'none' ? 'none' : '';
    };
    slot.querySelectorAll('.etm button').forEach((x) => x.addEventListener('click', () => { etm = x.dataset.m; etmVis(); }));
    etmVis();
    slot.scrollIntoView({ behavior: 'smooth', block: 'start' });
    slot.querySelector('.ec').addEventListener('click', () => { slot.innerHTML = ''; });
    slot.querySelector('.es').addEventListener('click', async (e) => {
      e.target.disabled = true;
      const v = (c) => slot.querySelector(c).value;
      const body = mcp ? { id, description: v('.ed'), url: v('.eu').trim(), token: etm === 'none' ? '' : v('.et').trim(), token_mode: etm } : { id, text: v('.ex') };
      const s = await api.rpc('POST', 'edit', body).catch((x) => ({ out: String(x.message || x) }));
      e.target.disabled = false;
      if (!s.ok) { slot.querySelector('.nst').textContent = s.out; return; }
      slot.innerHTML = '';
      load();
    });
  }
  container.querySelector('.new').addEventListener('click', newForm);

  q.addEventListener('input', render);
  container.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => {
    kind = b.dataset.k;
    container.querySelectorAll('.seg button').forEach((x) => x.classList.toggle('on', x === b));
    render();
  }));
  updAll.addEventListener('click', async () => {
    updAll.disabled = true;
    const r = await api.rpc('POST', 'update', {}).catch((e) => ({ out: String(e.message || e) }));
    updAll.disabled = false;
    if (!r.ok) window.alert(r.out);
    load();
  });
  load();
}

export function unmount(container) { container.innerHTML = ''; }
