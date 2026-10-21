// SERA Hub: public demo for hadiabid.com.
// Static copy of the local hub's Ship view. No server, no chat, no real data: the roster below is
// names + colours + rooms only, and "work" is simulated so the crew moves. Hover shows names only.
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const roster = {
  hub: { name: 'SERA' },
  agents: [
    { name: 'idea-developer', color: '#8fcf4f', room: 'nav', desk: 0 },
    { name: 'researcher', color: '#e86a5a', room: 'nav', desk: 1 },
    { name: 'it-security', color: '#a493f0', room: 'shields', desk: 0 },
    { name: 'concept-artist', color: '#f0709a', room: 'studio', desk: 0 },
    { name: 'story-writer', color: '#c57be0', room: 'studio', desk: 1 },
    { name: 'finance', color: '#e3c15a', room: 'vault', desk: 0 },
    { name: '3d-td', color: '#3cc0cf', room: 'eng', desk: 0 },
    { name: 'code-dev', color: '#6fa6f0', room: 'eng', desk: 1 },
  ],
};
const viz = { state: 'idle', level: 0, speak: 0, active: new Set() };
const colorOf = name => roster.agents.find(a => a.name === name)?.color || '#8c93a3';

window.seraHub = { roster, selected: null, select() {}, set3D() {}, viz, status: { busy: 0, agents: {} }, colorOf };

// ── outliner: names only, hover only ──────────────────────────
const row = (name, sw, cls = '') =>
  `<li class="${cls}${viz.active.has(name) ? ' busy' : ''}"><span class="sw" style="background:${sw}"></span><span class="nm">${esc(name)}</span>`
  + `${viz.active.has(name) ? `<i class="bdot" style="--c:${sw}"></i>` : ''}</li>`;
function renderOutliner() {
  $('outliner').innerHTML = row('HADI', '#e4e7ee') + row('SERA', '#7d8cff', 'child')
    + roster.agents.map(a => row(a.name, a.color, 'child')).join('');
}
$('count').textContent = roster.agents.length;
renderOutliner();

// ── right panel tabs (no data behind them) ────────────────────
document.querySelectorAll('.ptab').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.ptab').forEach(x => x.classList.toggle('on', x === b));
  document.querySelectorAll('.pane').forEach(p => { p.hidden = p.id !== `pane-${b.dataset.tab}`; });
}));

// ── simulated work: SERA "thinks", hands a task to an agent, it walks a packet to the core ──
const setState = s => { viz.state = s; const el = $('seraState'); el.textContent = s; el.className = `state ${s}`; };
function agent(name, on) {
  on ? viz.active.add(name) : viz.active.delete(name);
  document.dispatchEvent(new CustomEvent('sera:agent', { detail: { name, on } }));
  renderOutliner();
}
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
function tick() {
  const free = roster.agents.filter(a => !viz.active.has(a.name));
  if (free.length && viz.active.size < 2) {
    const a = free[Math.floor(Math.random() * free.length)].name;
    setState('thinking');
    setTimeout(() => { setState('idle'); agent(a, true); }, 1500);
    setTimeout(() => agent(a, false), 6000 + Math.random() * 5000);
  }
  setTimeout(tick, 5000 + Math.random() * 5000);
}
if (!reduce) setTimeout(tick, 2500);
