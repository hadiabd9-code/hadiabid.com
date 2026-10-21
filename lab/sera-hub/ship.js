// SERA Hub Ship view (Phase 2.5): 2D top-down pixel deck. SERA's bridge + core in the middle,
// one room per agent around it, placeholder robots walking packets to the core.
// Shares roster / selection / SERA state with the 3D view through window.seraHub (app.js),
// and reacts to the same delegation events (sera:agent) that light up the 3D nodes.
// Two looks over ONE simulation: 'pixel' (low-res buffer, integer-scaled) and 'schematic' (blueprint vectors).
import { TILE, loadAtlas, robotSheet, drawSprite, deckImage, roomImage, coreSheet, mix, shade, alpha } from './sprites.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const vp = $('viewport'), canvas = $('shipCanvas'), tip = $('shipTip');
const ctx = canvas.getContext('2d');
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const MONO = getComputedStyle(document.documentElement).getPropertyValue('--f-mono').trim() || 'monospace';

// If app.js didn't load (e.g. the three.js CDN is down) the deck still works, just without selection.
const fallback = { roster: { hub: {}, agents: [] }, selected: null, select() {}, set3D() {},
  viz: { state: 'idle', level: 0, speak: 0, active: new Set() }, colorOf: () => '#8c93a3' };
const hub = () => window.seraHub || fallback;

// ── deck layout (world pixels; 32 x 24 tiles of 32 px) ─────────
const W = 32 * TILE, H = 24 * TILE;
const RW = 8 * TILE, RH = 6 * TILE, GAP = 2 * TILE, X0 = 3 * TILE, Y0 = TILE;   // rooms 8x6 tiles, corridors 2 tiles
const roomRect = (c, r) => ({ x: X0 + c * (RW + GAP), y: Y0 + r * (RH + GAP), w: RW, h: RH });
const CX = X0 + RW + GAP + RW / 2, CY = Y0 + RH + GAP + RH / 2;      // the core (544, 384)
const VX = [X0 + RW + GAP / 2, X0 + 2 * RW + GAP * 1.5];               // vertical corridor centre lines
const HY = [Y0 + RH + GAP / 2, Y0 + 2 * RH + GAP * 1.5];               // horizontal corridor centre lines
const BRIDGE = { ...roomRect(1, 1), id: 'bridge' };
const HULL = [[64, 0], [W - 48, 0], [W, 48], [W, H - 48], [W - 48, H], [64, H]];
const ROOM_DEFS = [   // the blueprint's bays. Who sits where = "rooms" in sera.config.json (Hadi assigns; nothing auto-claims)
  { id: 'comms', c: 0, r: 0, name: 'COMMS', sub: 'SCANNER · OUTREACH' },
  { id: 'nav', c: 1, r: 0, name: 'NAVIGATION', sub: 'STAR CHART · PLANS' },
  { id: 'archive', c: 2, r: 0, name: 'ARCHIVE', sub: 'LOGS · SCRIPTS' },
  { id: 'shields', c: 0, r: 1, name: 'SHIELDS', sub: 'AUDIT · BACKUPS' },
  { id: 'studio', c: 2, r: 1, name: 'HOLO-STUDIO', sub: 'DESIGN · PROMPTS' },
  { id: 'code', c: 0, r: 2, name: 'CODE BAY', sub: 'TOOLS · APPS' },
  { id: 'vault', c: 1, r: 2, name: 'VAULT', sub: 'RESTRICTED', vault: true },
  { id: 'eng', c: 2, r: 2, name: 'ENGINEERING', sub: 'UNREAL · BLENDER · FX' },
];
const SHUTTLES = [['DARKROOM', 160], ['SERA HUB', 384], ['.AIBACKLOT', 608]];
const CHAIR = { x: CX + 58, y: CY - 46 };
const STATE_SPEED = { idle: 1, listening: 1.2, thinking: 4, speaking: 1.6 };
const STATE_TINT = { idle: '#c8b89a', listening: '#4fd18b', thinking: '#ffb547', speaking: '#7d8cff' };
const SPEED = { amble: 42, hurry: 115 };

// Each bay gets a door facing the bridge and a conduit from that door to the core. Desks (console + work
// spot + status light + path to the core) are laid out per room by deskLayout(), one per assigned agent.
const ROOMS = ROOM_DEFS.map((d, i) => {
  const r = { ...d, ...roomRect(d.c, d.r), bay: i + 1 };
  const side = d.c === 1 ? (d.r === 0 ? 'bottom' : 'top') : (d.c === 0 ? 'right' : 'left');
  const midX = r.x + r.w / 2, midY = r.y + r.h / 2;
  r.door = side === 'bottom' ? { side, x: midX, y: r.y + r.h, inn: { x: midX, y: r.y + r.h - 18 }, out: { x: midX, y: HY[0] } }
    : side === 'top' ? { side, x: midX, y: r.y, inn: { x: midX, y: r.y + 18 }, out: { x: midX, y: HY[1] } }
    : side === 'right' ? { side, x: r.x + r.w, y: midY, inn: { x: r.x + r.w - 18, y: midY }, out: { x: VX[0], y: midY } }
    : { side, x: r.x, y: midY, inn: { x: r.x + 18, y: midY }, out: { x: VX[1], y: midY } };
  r.side = side; r.midX = midX; r.midY = midY;
  r.outside = side === 'bottom' || side === 'top'   // door → core, shared by every desk in the room
    ? [r.door.inn, r.door.out, ...bridgeEntry(side === 'bottom' ? 'top' : 'bottom')]
    : [r.door.inn, r.door.out, { x: r.door.out.x, y: CY }, ...bridgeEntry(side === 'right' ? 'left' : 'right')];
  r.conduit = dedupe([{ x: r.door.x, y: r.door.y }, ...r.outside.slice(1)]);
  return r;
});
const ROOM_BY_ID = Object.fromEntries(ROOMS.map(r => [r.id, r]));

// k desks along the back wall of a room. One desk keeps the original single-console spot.
// Each desk: console x + width, work spot, status light (right end of the console), floor zone
// (for the busy glow + hover picking) and its own orthogonal path to the core.
function deskLayout(r, k) {
  k = Math.max(1, k);
  const xs = r.side === 'top'   // top-door rooms (vault): keep clear of the door in the middle of the back wall
    ? (k === 1 ? [r.x + 64] : Array.from({ length: k }, (_, i) => Math.round(r.x + 64 + i * (r.w - 120) / (k - 1))))
    : Array.from({ length: k }, (_, i) => Math.round(r.x + r.w * (i + 1) / (k + 1)));
  const cw = Math.max(24, Math.min(52, Math.floor(r.w / (k + 1)) - 10));
  return xs.map((x, i) => {
    const work = { x, y: r.y + 52 };
    const inner = r.side === 'bottom' || r.side === 'top' ? [work, { x: r.midX, y: work.y }] : [work, { x: work.x, y: r.midY }];
    return { i, room: r, console: { x, y: r.y + 6 }, cw, work, lamp: { x: x + cw / 2 - 6, y: r.y + 17 },
      zone: { x0: i ? Math.round((xs[i - 1] + x) / 2) : r.x, x1: i < k - 1 ? Math.round((x + xs[i + 1]) / 2) : r.x + r.w },
      path: dedupe([...inner, ...r.outside]) };
  });
}

function bridgeEntry(side) {   // bridge door, then a stop at the core's edge
  return side === 'top' ? [{ x: CX, y: BRIDGE.y }, { x: CX, y: CY - 38 }]
    : side === 'bottom' ? [{ x: CX, y: BRIDGE.y + BRIDGE.h }, { x: CX, y: CY + 38 }]
    : side === 'left' ? [{ x: BRIDGE.x, y: CY }, { x: CX - 40, y: CY }]
    : [{ x: BRIDGE.x + BRIDGE.w, y: CY }, { x: CX + 40, y: CY }];
}
function dedupe(pts) { return pts.filter((p, i) => !i || p.x !== pts[i - 1].x || p.y !== pts[i - 1].y); }
const rand = (a, b) => a + Math.random() * (b - a);

// Live status from the Claude Code hooks (app.js → seraHub.status): tasks per agent, for lights + tooltips.
const tasksOf = name => hub().status?.agents?.[name]?.tasks || [];
const ago = iso => { const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000)); return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`; };

// ── crew (one robot per assigned agent) ───────────────────────
// occupants: room id → agent names in desk order. deskOf: agent → its desk. Unassigned agents get no robot.
let crew = [], occupants = new Map(), deskOf = new Map(), unassigned = [], deck = null, delivered = 0, flashes = [], ripples = [];
const roomOf = name => deskOf.get(name)?.room || null;
const agentsIn = room => occupants.get(room.id) || [];

function assignDesks(agents) {
  occupants = new Map(); deskOf = new Map(); unassigned = [];
  const placed = agents.filter(a => a.room && ROOM_BY_ID[a.room]).sort((a, b) => (a.desk ?? 0) - (b.desk ?? 0));
  for (const a of placed) { if (!occupants.has(a.room)) occupants.set(a.room, []); occupants.get(a.room).push(a.name); }
  for (const [id, names] of occupants) deskLayout(ROOM_BY_ID[id], names.length).forEach((d, i) => deskOf.set(names[i], d));
  unassigned = agents.filter(a => !deskOf.has(a.name)).map(a => a.name);
}

function rebuild() {
  const { agents } = hub().roster;
  assignDesks(agents);
  const old = new Map(crew.map(c => [c.name, c]));
  crew = agents.filter(a => deskOf.has(a.name)).map((a, i) => {
    const desk = deskOf.get(a.name), room = desk.room, color = hub().colorOf(a.name);
    const prev = old.get(a.name);
    if (prev && prev.room === room && prev.desk.work.x === desk.work.x) return Object.assign(prev, { desk, color, sheet: robotSheet(a.name, color), agent: a });
    return { name: a.name, agent: a, room, desk, color, sheet: robotSheet(a.name, color), x: desk.work.x, y: desk.work.y,
      path: [], trail: [], goal: null, state: 'work', timer: rand(1, 6), flip: false, phase: i * 0.37,
      packet: null, busy: hub().viz.active?.has(a.name) || false, deliver: false, speed: SPEED.amble };
  });
  deck = buildDeck();
}

// Walk an orthogonal path. trail keeps where we came from so a robot can turn round mid-trip.
function go(c, pts, goal, speed = SPEED.amble) {
  c.path = dedupe([{ x: c.x, y: c.y }, ...pts]).slice(1);
  c.trail = [{ x: c.x, y: c.y }];
  c.goal = goal; c.state = 'walk'; c.speed = speed;
}
const lPath = (c, to) => [{ x: to.x, y: c.y }, to];   // inside a room: across, then down/up

function decide(c) {
  const home = c.desk.work, atHome = Math.hypot(c.x - home.x, c.y - home.y) < 1;
  if (c.state === 'atCore') return go(c, [...c.desk.path].reverse().slice(1), 'home', c.busy ? SPEED.hurry : SPEED.amble);
  if (c.busy) { if (!atHome) go(c, lPath(c, home), 'home', SPEED.hurry); else { c.state = 'work'; c.timer = 1; } return; }
  if (!atHome) return go(c, lPath(c, home), 'home');
  if (c.deliver) { c.deliver = false; c.packet = { color: c.color, big: true }; return go(c, c.desk.path.slice(1), 'core', SPEED.hurry); }
  const roll = Math.random();
  if (reduce) { c.state = 'work'; c.timer = 10; return; }
  if (roll < 0.3) { c.packet = { color: c.color }; return go(c, c.desk.path.slice(1), 'core'); }
  if (roll < 0.6) {
    const r = c.room, spot = { x: Math.round(rand(r.x + 30, r.x + r.w - 30)), y: Math.round(rand(r.y + 70, r.y + r.h - 22)) };
    return go(c, lPath(c, spot), 'wander');
  }
  c.state = 'work'; c.timer = rand(4, 9);
}

function arrive(c) {
  if (c.goal === 'core') {
    if (c.packet) { delivered++; flashes.push({ color: c.packet.color, t: 0, big: c.packet.big }); }
    c.packet = null; c.state = 'atCore'; c.timer = 0.6;
  } else if (c.goal === 'wander') { c.state = 'idle'; c.timer = rand(1.5, 4); }
  else { c.state = 'work'; c.timer = c.busy ? 1 : rand(4, 10); }
  c.goal = null;
}

function step(c, dt) {
  if (!c.path.length) { c.timer -= dt; if (c.timer <= 0) decide(c); return; }
  let move = c.speed * dt;
  while (move > 0 && c.path.length) {
    const p = c.path[0], dx = p.x - c.x, dy = p.y - c.y, d = Math.hypot(dx, dy);
    if (dx) c.flip = dx < 0;
    if (d <= move) { c.x = p.x; c.y = p.y; move -= d; c.trail.push(c.path.shift()); }
    else { c.x += dx / d * move; c.y += dy / d * move; move = 0; }
  }
  if (!c.path.length) arrive(c);
}

// Live hooks: SERA delegated (on) → hurry back to the console; reported back (off) → run a packet to the core.
document.addEventListener('sera:agent', e => {
  const c = crew.find(x => x.name === e.detail.name);
  if (!c) return;
  if (e.detail.on) {
    c.busy = true; c.deliver = false; c.packet = null;
    if (c.goal === 'core' || c.state === 'atCore') {        // turn round on the spot, retrace the corridor
      c.path = dedupe([...c.trail].reverse()).filter(p => p.x !== c.x || p.y !== c.y); c.trail = [{ x: c.x, y: c.y }];
      c.goal = 'home'; c.state = 'walk'; c.speed = SPEED.hurry;
    } else if (c.goal === 'home') c.speed = SPEED.hurry;   // already heading back: just run
    else if (c.goal === 'wander' || c.state !== 'work') go(c, lPath(c, c.desk.work), 'home', SPEED.hurry);
    else c.timer = 1;
  } else {
    c.busy = false; c.deliver = true;
    if (!c.path.length) c.timer = 0.35;
  }
});
document.addEventListener('sera:roster', rebuild);

// ── pixel helpers (crisp: no anti-aliased arcs inside the low-res buffer) ──
const px = (g, x, y, w, h, col) => { g.fillStyle = col; g.fillRect(Math.round(x), Math.round(y), w, h); };
function pxDisc(g, cx, cy, r, col) {
  g.fillStyle = col;
  for (let dy = -r; dy <= r; dy++) { const w = Math.floor(Math.sqrt(r * r - dy * dy)); g.fillRect(cx - w, cy + dy, w * 2 + 1, 1); }
}
function pxEllipse(g, cx, cy, rx, ry, rot, col, size = 2, dash = 0) {
  g.fillStyle = col;
  const n = Math.max(24, Math.round((rx + ry) * 3)), cr = Math.cos(rot), sr = Math.sin(rot);
  for (let i = 0; i < n; i++) {
    if (dash && Math.floor(i / dash) % 2) continue;
    const a = i / n * Math.PI * 2, x = Math.cos(a) * rx, y = Math.sin(a) * ry;
    g.fillRect(Math.round(cx + x * cr - y * sr - size / 2), Math.round(cy + x * sr + y * cr - size / 2), size, size);
  }
}
function pxPoly(g, pts, col) {   // scanline fill for the convex hull shape
  g.fillStyle = col;
  const ys = pts.map(p => p[1]);
  for (let y = Math.min(...ys); y < Math.max(...ys); y++) {
    const xs = [];
    pts.forEach((a, i) => { const b = pts[(i + 1) % pts.length];
      if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) xs.push(a[0] + (y + 0.5 - a[1]) / (b[1] - a[1]) * (b[0] - a[0])); });
    if (xs.length >= 2) { const l = Math.round(Math.min(...xs)), r = Math.round(Math.max(...xs)); g.fillRect(l, y, r - l, 1); }
  }
}
function inConvex(pts, [x, y]) {   // clockwise polygon: point is inside if it's right of every edge
  return pts.every((a, i) => { const b = pts[(i + 1) % pts.length]; return (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]) >= 0; });
}
const inset = (pts, d) => pts.map(([x, y]) => [x + (x <= 64 ? d : x >= W - 48 ? -d : 0), y + (y <= 0 ? d : y >= H ? -d : 0)]);
function pathPos(pts, f) {
  let total = 0; const seg = [];
  for (let i = 0; i < pts.length - 1; i++) { const l = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y); seg.push(l); total += l; }
  let d = ((f % 1) + 1) % 1 * total;
  for (let i = 0; i < seg.length; i++) { if (d <= seg[i]) { const k = d / seg[i]; return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * k, y: pts[i].y + (pts[i + 1].y - pts[i].y) * k }; } d -= seg[i]; }
  return pts[pts.length - 1];
}
function seeded(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// ── static deck (rebuilt only when the roster changes) ────────
const SPACE = '#07080b', WALL = '#121419', CORR = '#1c1f25', CORR2 = '#20232a', TAN = '#c8b89a';

function buildDeck() {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
  const art = deckImage();
  if (art) {   // full painted deck; per-bay art (if any) still goes on top
    g.drawImage(art, 0, 0, W, H);
    for (const r of ROOMS) { const img = roomImage(r.id); if (img) g.drawImage(img, r.x, r.y, r.w, r.h); }
    return c;
  }
  px(g, 0, 0, W, H, SPACE);
  const rnd = seeded(7);
  for (let i = 0; i < 260; i++) px(g, rnd() * W, rnd() * H, 1, 1, `rgba(220,225,240,${0.15 + rnd() * 0.6})`);
  // hull + corridor floor
  pxPoly(g, HULL, '#3a3e48'); pxPoly(g, inset(HULL, 3), '#2a2d35'); pxPoly(g, inset(HULL, 6), CORR);
  const inner = inset(HULL, 6);
  for (let x = 64; x < W; x += TILE) for (let y = 0; y < H; y += TILE)
    if (((x - 64) / TILE + y / TILE) % 2 && [[x, y], [x + TILE, y], [x, y + TILE], [x + TILE, y + TILE]].every(p => inConvex(inner, p)))
      px(g, x + 1, y + 1, TILE - 2, TILE - 2, CORR2);
  // shuttles docked at the stern
  for (const [, sy] of SHUTTLES) {
    px(g, 50, sy - 6, 16, 12, '#3a3e48'); px(g, 52, sy - 4, 12, 8, '#22252c');                       // docking collar
    px(g, 12, sy - 7, 38, 14, '#0d0e12'); px(g, 14, sy - 6, 34, 12, '#d9dde4'); px(g, 14, sy + 2, 34, 4, '#b5bac4');
    px(g, 8, sy - 3, 6, 6, '#d9dde4'); px(g, 16, sy - 4, 8, 4, '#5fa8f0'); px(g, 30, sy - 6, 3, 12, '#d65a4a');
    px(g, 36, sy - 12, 8, 6, '#b5bac4'); px(g, 36, sy + 6, 8, 6, '#b5bac4');                        // fins
  }
  // conduits from each occupied bay to the bridge (agent colour, dim)
  for (const r of ROOMS) { const a = agentsIn(r)[0]; if (a) drawConduit(g, r.conduit, alpha(hub().colorOf(a), 0.35)); }
  for (const r of ROOMS) drawRoom(g, r, agentsIn(r));
  drawBridge(g);
  return c;
}

function drawConduit(g, pts, col) {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    px(g, Math.min(a.x, b.x) - 1, Math.min(a.y, b.y) - 1, Math.abs(b.x - a.x) + 2, Math.abs(b.y - a.y) + 2, col);
  }
}

function drawRoom(g, r, names) {   // floor + trim take the first occupant's colour; each console its own agent's
  const agent = names[0], col = agent ? hub().colorOf(agent) : '#5a5f6b';
  const desks = names.length ? names.map(n => deskOf.get(n)) : deskLayout(r, 1);
  const art = roomImage(r.id);
  px(g, r.x, r.y, r.w, r.h, WALL);
  if (art) g.drawImage(art, r.x, r.y, r.w, r.h);
  else {
    const f1 = mix(col, '#15171c', agent ? 0.84 : 0.9), f2 = mix(col, '#15171c', agent ? 0.88 : 0.93);
    for (let x = 0; x < r.w - 12; x += TILE) for (let y = 0; y < r.h - 12; y += TILE)
      px(g, r.x + 6 + x, r.y + 6 + y, Math.min(TILE, r.w - 12 - x), Math.min(TILE, r.h - 12 - y), ((x + y) / TILE) % 2 ? f2 : f1);
    for (let x = TILE; x < r.w - 12; x += TILE) px(g, r.x + 6 + x, r.y + 6, 1, r.h - 12, 'rgba(0,0,0,.25)');
    for (let y = TILE; y < r.h - 12; y += TILE) px(g, r.x + 6, r.y + 6 + y, r.w - 12, 1, 'rgba(0,0,0,.25)');
    px(g, r.x + 6, r.y + 6, r.w - 12, 5, 'rgba(0,0,0,.3)');                              // shadow under the back wall
    // trim
    px(g, r.x + 5, r.y + 5, r.w - 10, 1, shade(col, 0.8)); px(g, r.x + 5, r.y + r.h - 6, r.w - 10, 1, shade(col, 0.8));
    px(g, r.x + 5, r.y + 5, 1, r.h - 10, shade(col, 0.8)); px(g, r.x + r.w - 6, r.y + 5, 1, r.h - 10, shade(col, 0.8));
    // one console per desk on the back wall (status light at its right end is drawn per frame)
    desks.forEach((d, i) => {
      const cx = d.console.x, h = d.cw / 2, dc = names[i] ? hub().colorOf(names[i]) : col;
      px(g, cx - h, r.y + 4, d.cw, 20, '#0d0e12'); px(g, cx - h + 2, r.y + 6, d.cw - 4, 16, '#2a2d35');
      px(g, cx - h + 6, r.y + 8, d.cw - 12, 7, shade(dc, 0.55)); px(g, cx - h + 8, r.y + 9, Math.round(d.cw / 4), 1, dc); px(g, cx - 2, r.y + 11, Math.round(d.cw / 3), 1, dc);
      for (let k = 0; k < Math.floor((d.cw - 16) / 8); k++) px(g, cx - h + 8 + k * 8, r.y + 18, 4, 2, k % 2 ? '#4fd18b' : '#6b7180');
    });
    // cabinets either side of the console (generic props until real room art)
    const cy = r.y + 6;
    for (const x of [r.x + 10, r.x + r.w - 30]) {
      px(g, x, cy, 20, 26, '#0d0e12'); px(g, x + 1, cy + 1, 18, 24, '#30343e');
      for (let k = 0; k < 3; k++) px(g, x + 4, cy + 4 + k * 7, 3, 2, k === 1 ? col : '#6b7180');
    }
    if (r.vault) {   // round vault door on the left wall
      pxDisc(g, r.x + 40, r.y + r.h / 2 + 10, 22, '#0d0e12'); pxDisc(g, r.x + 40, r.y + r.h / 2 + 10, 20, shade(col, 0.6));
      pxEllipse(g, r.x + 40, r.y + r.h / 2 + 10, 13, 13, 0, col, 2); pxDisc(g, r.x + 40, r.y + r.h / 2 + 10, 4, col);
    }
  }
  // door: gap in the wall + frame posts
  const d = r.door, horiz = d.side === 'top' || d.side === 'bottom', fl = mix(col, '#15171c', 0.84);
  if (horiz) { px(g, d.x - 22, d.side === 'top' ? r.y : r.y + r.h - 6, 44, 6, fl); px(g, d.x - 26, d.side === 'top' ? r.y - 2 : r.y + r.h - 8, 4, 10, '#4a4f5a'); px(g, d.x + 22, d.side === 'top' ? r.y - 2 : r.y + r.h - 8, 4, 10, '#4a4f5a'); }
  else { const wx = d.side === 'left' ? r.x : r.x + r.w - 6; px(g, wx, d.y - 22, 6, 44, fl); px(g, wx - 2, d.y - 26, 10, 4, '#4a4f5a'); px(g, wx - 2, d.y + 22, 10, 4, '#4a4f5a'); }
}

function drawBridge(g) {
  const b = BRIDGE;
  px(g, b.x, b.y, b.w, b.h, '#0d0e12'); px(g, b.x + 2, b.y + 2, b.w - 4, b.h - 4, '#3a352b');
  for (let x = 0; x < b.w - 12; x += TILE) for (let y = 0; y < b.h - 12; y += TILE)
    px(g, b.x + 6 + x, b.y + 6 + y, Math.min(TILE, b.w - 12 - x), Math.min(TILE, b.h - 12 - y), ((x + y) / TILE) % 2 ? '#211f1b' : '#25221d');
  px(g, b.x + 5, b.y + 5, b.w - 10, 1, '#8a7f6a'); px(g, b.x + 5, b.y + b.h - 6, b.w - 10, 1, '#8a7f6a');
  px(g, b.x + 5, b.y + 5, 1, b.h - 10, '#8a7f6a'); px(g, b.x + b.w - 6, b.y + 5, 1, b.h - 10, '#8a7f6a');
  for (const s of ['top', 'bottom']) px(g, CX - 22, s === 'top' ? b.y : b.y + b.h - 6, 44, 6, '#25221d');
  for (const s of ['left', 'right']) px(g, s === 'left' ? b.x : b.x + b.w - 6, CY - 22, 6, 44, '#25221d');
  pxDisc(g, CX, CY, 62, '#0d0e12'); pxDisc(g, CX, CY, 60, '#2e2a23'); pxDisc(g, CX, CY, 50, '#38332a');
  pxEllipse(g, CX, CY, 60, 60, 0, TAN, 2); pxEllipse(g, CX, CY, 54, 54, 0, '#6b6252', 1, 3);
  // captain's chair (Hadi's seat), facing the bow
  px(g, CHAIR.x - 9, CHAIR.y - 8, 18, 18, '#0d0e12'); px(g, CHAIR.x - 7, CHAIR.y - 6, 14, 14, '#a8916b');
  px(g, CHAIR.x + 3, CHAIR.y - 9, 7, 20, '#0d0e12'); px(g, CHAIR.x + 4, CHAIR.y - 8, 5, 18, '#8a7553');
  px(g, CHAIR.x - 5, CHAIR.y - 4, 8, 10, '#c4ab80');
}

// ── per-frame drawing: pixel look ─────────────────────────────
const buf = document.createElement('canvas'); buf.width = W; buf.height = H;
const bg = buf.getContext('2d'); bg.imageSmoothingEnabled = false;
let spin = 0, lastSpeak = 0, hover = null;

function drawPixel(t) {
  const viz = hub().viz, sel = hub().selected;
  bg.drawImage(deck, 0, 0);
  // busy bays glow; data trickles along every conduit (faster when the agent is working)
  for (const c of crew) {
    const r = c.room, d = c.desk;
    if (c.busy) {   // glow only this agent's desk zone; the bay frame lights in its colour
      const a = 0.1 + 0.06 * Math.sin(t * 5), x0 = Math.max(d.zone.x0, r.x + 6), x1 = Math.min(d.zone.x1, r.x + r.w - 6);
      px(bg, x0, r.y + 6, x1 - x0, r.h - 12, alpha(c.color, a));
      for (const [x, y, w, h] of [[r.x, r.y, r.w, 2], [r.x, r.y + r.h - 2, r.w, 2], [r.x, r.y, 2, r.h], [r.x + r.w - 2, r.y, 2, r.h]]) px(bg, x, y, w, h, c.color);
      px(bg, d.console.x - d.cw / 2 + 6, r.y + 8, d.cw - 12, 7, Math.sin(t * 12) > 0 ? c.color : shade(c.color, 0.8));
    }
    // desk status light: steady dim green = idle, blinking amber = busy
    const l = d.lamp, on = c.busy && (reduce || Math.sin(t * 9) > -0.2);
    if (c.busy) px(bg, l.x - 3, l.y - 3, 11, 11, alpha('#ffb547', on ? 0.3 : 0.08));
    px(bg, l.x - 1, l.y - 1, 7, 7, '#0d0e12');
    px(bg, l.x, l.y, 5, 5, c.busy ? (on ? '#ffb547' : '#6b4a1c') : '#2e6b4a');
    px(bg, l.x + 1, l.y + 1, 2, 2, c.busy ? (on ? '#fff1d2' : '#6b4a1c') : '#4fd18b');
    const line = r.conduit, n = c.busy ? 3 : 1;
    for (let k = 0; k < n; k++) { const p = pathPos(line, t * (c.busy ? 0.5 : 0.12) + k / n + c.phase); px(bg, p.x - 1, p.y - 1, 3, 3, c.color); }
  }
  // selection / hover outline
  for (const [pick, col] of [[hover, 'rgba(228,231,238,.55)'], [sel, '#ffb547']]) {
    const r = pick?.type === 'agent' ? roomOf(pick.name) : pick?.type === 'hub' ? BRIDGE : null;
    if (r) for (const [x, y, w, h] of [[r.x - 2, r.y - 2, r.w + 4, 2], [r.x - 2, r.y + r.h, r.w + 4, 2], [r.x - 2, r.y - 2, 2, r.h + 4], [r.x + r.w, r.y - 2, 2, r.h + 4]]) px(bg, x, y, w, h, col);
  }
  drawCore(bg, t, viz);
  // halo over the captain's chair
  if (sel?.type === 'hadi' || hover?.type === 'hadi') pxEllipse(bg, CHAIR.x, CHAIR.y, 14, 14, 0, sel?.type === 'hadi' ? '#ffb547' : '#e4e7ee', 1);
  pxEllipse(bg, CHAIR.x, CHAIR.y - 16 + Math.round(Math.sin(t * 2)), 7, 2, 0, '#f3e6c9', 1);
  // crew, back to front
  for (const c of [...crew].sort((a, b) => a.y - b.y)) {
    const isSel = sel?.type === 'agent' && sel.name === c.name;
    if (isSel) pxEllipse(bg, c.x, c.y, 11, 4, 0, '#ffb547', 1);
    const anim = c.state === 'walk' ? 'walk' : c.state === 'work' ? 'work' : 'idle';
    drawSprite(bg, c.sheet, anim, t * (c.busy ? 1.8 : 1), c.x, c.y, c.flip, c.phase * 3);
    if (c.packet) {
      const s = c.packet.big ? 8 : 6, [hx, hy] = c.sheet.hold, x = Math.round(c.x + hx - s / 2), y = Math.round(c.y + hy - s / 2 + Math.sin(t * 6 + c.phase));
      px(bg, x - 1, y - 1, s + 2, s + 2, '#0d0e12'); px(bg, x, y, s, s, c.packet.color); px(bg, x, y, s, 1, 'rgba(255,255,255,.6)');
    }
  }
}

function drawCore(g, t, viz) {
  const tint = STATE_TINT[viz.state] || TAN;
  const listen = viz.state === 'listening' ? 0.15 + (viz.level || 0) * 0.6 : 0;
  const k1 = 1 + listen * (0.6 + Math.sin(t * 8) * 0.4), k2 = 1 + listen * (0.6 + Math.cos(t * 7) * 0.4);
  const glow = viz.state === 'thinking' ? 0.35 + Math.sin(t * 9) * 0.2 : viz.state === 'speaking' ? 0.25 + (viz.speak || 0) * 0.4 : 0.18 + Math.sin(t * 2) * 0.06;
  pxDisc(g, CX, CY, 34, alpha(tint, glow * 0.5)); pxDisc(g, CX, CY, 26, alpha(tint, glow * 0.6));
  for (const f of flashes) pxEllipse(g, CX, CY, 18 + f.t * 60, 18 + f.t * 60, 0, alpha(f.color, 1 - f.t), f.big ? 3 : 2);
  for (const r of ripples) pxEllipse(g, CX, CY, 20 + r.t * 34, 20 + r.t * 34, 0, alpha('#7d8cff', 0.8 * (1 - r.t)), 1);
  const sheet = coreSheet();
  if (sheet) {
    const a = sheet.anims[viz.state] || sheet.anims.idle || { row: 0, frames: 1, fps: 1 };
    const f = Math.floor(t * a.fps) % a.frames, [fw, fh] = sheet.frame;
    g.drawImage(sheet.img, f * fw, a.row * fh, fw, fh, CX - sheet.anchor[0], CY - sheet.anchor[1], fw, fh);
  } else {
    pxEllipse(g, CX, CY, 34 * k1, 11 * k1, spin * 0.4, tint, 2);                         // ring A (back half drawn under the sphere)
    pxDisc(g, CX, CY, 16, '#0d0e12'); pxDisc(g, CX, CY, 15, '#c9b48e'); pxDisc(g, CX - 2, CY - 2, 12, '#e8d5b0');
    pxDisc(g, CX - 5, CY - 6, 4, '#f7eedb'); px(g, CX - 7, CY - 8, 2, 2, '#ffffff');
    if (viz.state === 'thinking') pxDisc(g, CX, CY, 6, alpha('#ffb547', 0.5 + Math.sin(t * 14) * 0.4));
    // ring A front half + ring B, so the rings read as orbiting the core
    const cr = Math.cos(spin * 0.4), sr = Math.sin(spin * 0.4);
    for (let i = 0; i < 90; i++) { const a = i / 90 * Math.PI; const x = Math.cos(a) * 34 * k1, y = Math.sin(a) * 11 * k1;
      px(g, CX + x * cr - y * sr - 1, CY + x * sr + y * cr - 1, 2, 2, tint); }
    pxEllipse(g, CX, CY, 26 * k2, 26 * k2 * 0.35, -spin * 0.3 + 1.1, alpha(tint, 0.7), 1, 4);
    for (let i = 0; i < 3; i++) { const a = spin * 1.5 + i * 2.09; px(g, CX + Math.cos(a) * 44 - 1, CY + Math.sin(a) * 44 - 1, 3, 3, tint); }
  }
}

// ── per-frame drawing: schematic look (blueprint port) ────────
function drawSchematic(t, s, ox, oy) {
  const viz = hub().viz, sel = hub().selected, col = name => hub().colorOf(name);
  ctx.save(); ctx.setTransform(s, 0, 0, s, ox, oy);
  const lw = 1 / s;
  // grid
  ctx.lineWidth = lw;
  for (let x = 0; x <= W; x += 16) { ctx.strokeStyle = x % 64 ? 'rgba(200,184,154,.05)' : 'rgba(200,184,154,.11)'; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y <= H; y += 16) { ctx.strokeStyle = y % 64 ? 'rgba(200,184,154,.05)' : 'rgba(200,184,154,.11)'; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  // hull
  const hull = () => { ctx.beginPath(); HULL.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); };
  hull(); ctx.strokeStyle = 'rgba(200,184,154,.6)'; ctx.lineWidth = 1.6 * lw; ctx.stroke();
  ctx.save(); ctx.translate(W / 2, H / 2); ctx.scale(0.985, 0.98); ctx.translate(-W / 2, -H / 2); hull();
  ctx.setLineDash([2, 6]); ctx.strokeStyle = 'rgba(200,184,154,.28)'; ctx.lineWidth = lw; ctx.stroke(); ctx.restore();
  ctx.setLineDash([]);
  ctx.font = `10px ${MONO}`; ctx.fillStyle = 'rgba(200,184,154,.6)';
  for (const [name, y] of SHUTTLES) {
    ctx.strokeStyle = 'rgba(200,184,154,.55)'; ctx.beginPath(); ctx.moveTo(64, y); ctx.lineTo(50, y);
    ctx.moveTo(50, y - 7); ctx.lineTo(14, y - 7); ctx.lineTo(6, y); ctx.lineTo(14, y + 7); ctx.lineTo(50, y + 7); ctx.closePath(); ctx.stroke();
    ctx.save(); ctx.translate(30, y - 12); ctx.textAlign = 'center'; ctx.font = `7px ${MONO}`; ctx.fillText(name, 0, 0); ctx.restore();
  }
  // conduits (marching dashes)
  ctx.setLineDash([3, 7]); ctx.lineDashOffset = -t * 12; ctx.lineWidth = 1.4 * lw;
  for (const c of crew) {
    const pts = c.room.conduit;
    ctx.strokeStyle = alpha(c.color, c.busy ? 0.95 : 0.7); ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.stroke();
  }
  ctx.setLineDash([]);
  // bays
  for (const r of ROOMS) {
    const names = agentsIn(r), a = names[0], c = a ? col(a) : 'rgba(200,184,154,.3)';
    const has = p => p?.type === 'agent' && names.includes(p.name), busyC = crew.find(x => x.room === r && x.busy);
    ctx.fillStyle = busyC ? alpha(busyC.color, 0.06 + 0.04 * Math.sin(t * 5)) : has(hover) || has(sel) ? 'rgba(255,255,255,.05)' : 'rgba(255,255,255,.012)';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = has(sel) ? '#ffb547' : c; ctx.lineWidth = 1.4 * lw; ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = 'rgba(200,184,154,.55)'; ctx.font = `8px ${MONO}`; ctx.fillText('BAY-0' + r.bay, r.x + 8, r.y + 14);
    ctx.fillStyle = c; ctx.font = `11px ${MONO}`; ctx.fillText(a ? r.name : 'VACANT', r.x + 8, r.y + r.h - 22);
    ctx.fillStyle = '#7a776f'; ctx.font = `8px ${MONO}`; ctx.fillText(a ? (names.length > 1 ? names.join(' · ').toUpperCase() : `${a.toUpperCase()} · ${r.sub}`) : r.sub, r.x + 8, r.y + r.h - 9);
    if (r.vault) {
      ctx.strokeStyle = c; ctx.beginPath(); ctx.arc(r.x + 40, r.y + r.h / 2 + 4, 24, 0, 7); ctx.stroke();
      ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.arc(r.x + 40, r.y + r.h / 2 + 4, 17, 0, 7); ctx.stroke(); ctx.setLineDash([]);
    }
    for (const [i, d] of (names.length ? names.map(n => deskOf.get(n)) : deskLayout(r, 1)).entries()) {   // a console + light per desk
      const dc = names[i] ? col(names[i]) : c, w = d.cw - 16, busy = crew.find(x => x.name === names[i])?.busy;
      ctx.strokeStyle = dc; ctx.lineWidth = lw; ctx.strokeRect(d.console.x - w / 2, r.y + 8, w, 16);
      ctx.setLineDash([2, 2]); ctx.beginPath(); ctx.moveTo(d.console.x - w / 2 + 6, r.y + 16); ctx.lineTo(d.console.x + w / 2 - 6, r.y + 16); ctx.stroke(); ctx.setLineDash([]);
      if (names[i]) { ctx.fillStyle = busy ? alpha('#ffb547', 0.55 + 0.45 * Math.sin(t * 9)) : '#2e6b4a'; ctx.beginPath(); ctx.arc(d.console.x + w / 2 + 5, r.y + 16, 3, 0, 7); ctx.fill(); }
    }
  }
  // bridge (octagon) + core
  const b = BRIDGE, k = 34;
  ctx.beginPath(); [[b.x + k, b.y], [b.x + b.w - k, b.y], [b.x + b.w, b.y + k], [b.x + b.w, b.y + b.h - k], [b.x + b.w - k, b.y + b.h], [b.x + k, b.y + b.h], [b.x, b.y + b.h - k], [b.x, b.y + k]]
    .forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath();
  ctx.fillStyle = hover?.type === 'hub' ? 'rgba(255,255,255,.05)' : 'rgba(255,255,255,.012)'; ctx.fill();
  ctx.strokeStyle = sel?.type === 'hub' ? '#ffb547' : TAN; ctx.lineWidth = 1.4 * lw; ctx.stroke();
  const tint = STATE_TINT[viz.state] || TAN, listen = viz.state === 'listening' ? 0.15 + (viz.level || 0) * 0.6 : 0;
  ctx.lineWidth = 0.8 * lw; ctx.setLineDash([2, 4]); ctx.strokeStyle = alpha(TAN, 0.6); ctx.beginPath(); ctx.arc(CX, CY, 62, 0, 7); ctx.stroke(); ctx.setLineDash([]);
  ctx.strokeStyle = tint; ctx.lineWidth = 1.2 * lw;
  ctx.beginPath(); ctx.ellipse(CX, CY, 46 * (1 + listen), 16 * (1 + listen), spin * 0.4, 0, 7); ctx.stroke();
  ctx.setLineDash([6, 6]); ctx.lineWidth = 0.7 * lw; ctx.beginPath(); ctx.arc(CX, CY, 40 * (1 + listen * 0.7), -spin * 0.3, -spin * 0.3 + 7); ctx.stroke(); ctx.setLineDash([]);
  const pulse = viz.state === 'thinking' ? 0.5 + Math.sin(t * 9) * 0.3 : viz.state === 'speaking' ? 0.4 + (viz.speak || 0) * 0.5 : 0.35 + Math.sin(t * 2.6) * 0.15;
  const grd = ctx.createRadialGradient(CX, CY, 0, CX, CY, 34); grd.addColorStop(0, '#f3e6c9'); grd.addColorStop(0.55, alpha(tint, 0.9)); grd.addColorStop(1, alpha(tint, 0));
  ctx.globalAlpha = pulse; ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(CX, CY, 34, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
  ctx.fillStyle = '#e8d5b0'; ctx.beginPath(); ctx.arc(CX, CY, 17, 0, 7); ctx.fill();
  for (const f of flashes) { ctx.strokeStyle = alpha(f.color, 1 - f.t); ctx.lineWidth = lw * 1.5; ctx.beginPath(); ctx.arc(CX, CY, 18 + f.t * 60, 0, 7); ctx.stroke(); }
  for (const r of ripples) { ctx.strokeStyle = alpha('#7d8cff', 0.8 * (1 - r.t)); ctx.lineWidth = lw; ctx.beginPath(); ctx.arc(CX, CY, 20 + r.t * 34, 0, 7); ctx.stroke(); }
  ctx.strokeStyle = '#e8d5b0'; ctx.lineWidth = 1.2 * lw;
  ctx.strokeRect(CHAIR.x - 7, CHAIR.y - 10, 14, 20); ctx.beginPath(); ctx.ellipse(CHAIR.x, CHAIR.y - 16, 8, 2.5, 0, 0, 7); ctx.stroke();
  ctx.fillStyle = '#f0ede6'; ctx.font = `11px ${MONO}`; ctx.textAlign = 'center'; ctx.fillText('BRIDGE · SERA', CX, b.y + b.h - 22);
  ctx.fillStyle = '#7a776f'; ctx.font = `8px ${MONO}`; ctx.fillText(`CORE · ${viz.state.toUpperCase()}`, CX, b.y + b.h - 10); ctx.textAlign = 'left';
  // drones: ring + bar + packet (as in the blueprint)
  for (const c of crew) {
    ctx.fillStyle = '#0b0c0e'; ctx.strokeStyle = c.color; ctx.lineWidth = 1.6 * lw;
    ctx.beginPath(); ctx.arc(c.x, c.y - 8, 7, 0, 7); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(c.x - 3.5, c.y - 8); ctx.lineTo(c.x + 3.5, c.y - 8); ctx.stroke();
    if (sel?.type === 'agent' && sel.name === c.name) { ctx.strokeStyle = '#ffb547'; ctx.lineWidth = lw; ctx.beginPath(); ctx.arc(c.x, c.y - 8, 11, 0, 7); ctx.stroke(); }
    if (c.packet) { ctx.fillStyle = c.packet.color; const z = c.packet.big ? 8 : 6; ctx.fillRect(c.x + 8, c.y - 19, z, z); }
  }
  ctx.restore();
}

// ── device-res overlay text (crisp at any scale) ──────────────
function drawLabels(s, ox, oy, schematic) {
  const fs = Math.max(10, Math.round(9 * s));   // ~9 world px, so labels keep their size relative to the deck
  ctx.textBaseline = 'alphabetic';
  if (!schematic) {
    for (const r of ROOMS) {
      const names = agentsIn(r), a = names[0], x = ox + (r.x + 10) * s, y = oy + (r.y + r.h - 12) * s;
      ctx.font = `600 ${fs}px ${MONO}`; ctx.fillStyle = a ? hub().colorOf(a) : '#6b7180';
      ctx.fillText(a ? r.name : 'VACANT', x, y - fs * 1.15);
      ctx.font = `${Math.round(fs * 0.9)}px ${MONO}`; ctx.fillStyle = '#8c93a3'; ctx.fillText(a ? names.join(' · ') : r.sub, x, y);
    }
    ctx.font = `600 ${fs}px ${MONO}`; ctx.fillStyle = TAN; ctx.textAlign = 'center';
    ctx.fillText('SERA', ox + CX * s, oy + (BRIDGE.y + BRIDGE.h - 12) * s); ctx.textAlign = 'left';
  }
  // "working…" tags over busy robots
  for (const c of crew) if (c.busy) {
    const n = tasksOf(c.name).length, text = n > 1 ? `working ×${n}` : 'working…', x = ox + c.x * s, y = oy + (c.y - 46) * s;
    ctx.font = `500 ${fs}px ${MONO}`;
    const w = ctx.measureText(text).width + fs;
    ctx.fillStyle = 'rgba(21,23,28,.88)'; ctx.fillRect(Math.round(x - w / 2), Math.round(y - fs), Math.round(w), Math.round(fs * 1.5));
    ctx.strokeStyle = c.color; ctx.lineWidth = 1; ctx.strokeRect(Math.round(x - w / 2) + 0.5, Math.round(y - fs) + 0.5, Math.round(w) - 1, Math.round(fs * 1.5) - 1);
    ctx.fillStyle = c.color; ctx.textAlign = 'center'; ctx.fillText(text, x, y + fs * 0.25); ctx.textAlign = 'left';
  }
}

// ── loop / sizing ─────────────────────────────────────────────
let view = 'ship', mode = 'pixel', raf = 0, last = 0, clock = 0, hudTick = 0;
let fit = { s: 1, ox: 0, oy: 0 };

function resize() {
  const dpr = devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(vp.clientWidth * dpr)); canvas.height = Math.max(1, Math.round(vp.clientHeight * dpr));
  const k = Math.min(canvas.width / W, canvas.height / H);
  const s = k >= 1 ? Math.floor(k) : k;   // integer scale whenever the deck fits; shrink only on tiny viewports
  fit = { s, ox: Math.floor((canvas.width - W * s) / 2), oy: Math.floor((canvas.height - H * s) / 2) };
}
new ResizeObserver(() => { if (view === 'ship') resize(); }).observe(vp);

function frame(now) {
  raf = requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - (last || now)) / 1000); last = now;
  const viz = hub().viz;
  clock += dt;
  if (!reduce) spin += dt * (STATE_SPEED[viz.state] || 1);
  // speaking ripples on audio peaks (viz.speak is pulsed by chat.js and decays in app.js)
  if (viz.state === 'speaking' && (viz.speak || 0) > 0.7 && clock - lastSpeak > 0.14) { ripples.push({ t: 0 }); lastSpeak = clock; }
  for (const list of [flashes, ripples]) { for (const f of list) f.t += dt * (list === flashes ? 1.4 : 1.6); while (list.length && list[0].t >= 1) list.shift(); }
  for (const c of crew) step(c, dt);
  if (!deck) return;

  const { s, ox, oy } = fit, schematic = mode === 'schematic';
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = schematic ? '#0b0c0e' : SPACE; ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (schematic) drawSchematic(clock, s, ox, oy);
  else {
    drawPixel(clock);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(buf, ox, oy, W * s, H * s);
  }
  drawLabels(s, ox, oy, schematic);
  if ((hudTick -= dt) <= 0) {
    hudTick = 0.5;
    const busy = crew.filter(c => c.busy).length;
    $('hudRight').textContent = `crew ${crew.length}${unassigned.length ? ` · ${unassigned.length} need a room` : ''} · packets to core ${delivered}${busy ? ` · ${busy} working` : ''}`;
  }
}

// ── picking: robots first, then rooms, chair, core/bridge, shuttles ──
function pickAt(e) {
  const r = canvas.getBoundingClientRect(), dpr = canvas.width / r.width;
  const x = ((e.clientX - r.left) * dpr - fit.ox) / fit.s, y = ((e.clientY - r.top) * dpr - fit.oy) / fit.s;
  const bot = [...crew].sort((a, b) => b.y - a.y).find(c => Math.abs(x - c.x) < 12 && y > c.y - 30 && y < c.y + 3);
  if (bot) return { pick: { type: 'agent', name: bot.name }, what: 'robot', c: bot };
  if (Math.abs(x - CHAIR.x) < 12 && Math.abs(y - CHAIR.y) < 14) return { pick: { type: 'hadi' }, what: 'chair' };
  const inR = q => x >= q.x && x < q.x + q.w && y >= q.y && y < q.y + q.h;
  if (inR(BRIDGE)) return { pick: { type: 'hub' }, what: 'bridge' };
  for (const room of ROOMS) if (inR(room) && agentsIn(room).length) {
    const name = agentsIn(room).find(n => { const z = deskOf.get(n).zone; return x >= z.x0 && x < z.x1; }) || agentsIn(room)[0];
    return { pick: { type: 'agent', name }, what: 'room', c: crew.find(c => c.name === name) };
  }
  const sh = SHUTTLES.find(([, sy]) => x >= 4 && x < 66 && Math.abs(y - sy) < 14);
  if (sh) return { pick: null, what: 'shuttle', name: sh[0] };
  const room = ROOMS.find(inR);
  if (room) return { pick: null, what: 'vacant', room };
  return null;
}

const doing = c => c.busy ? (c.path.length ? 'hurrying to the console' : 'working…')
  : c.goal === 'core' ? 'carrying a packet to the core' : c.state === 'atCore' ? 'at the core'
  : c.state === 'walk' ? 'on the move' : c.state === 'work' ? 'at the console' : 'idle';

canvas.addEventListener('pointermove', e => {
  const h = pickAt(e);
  hover = h?.pick || null;
  canvas.classList.toggle('hot', !!h?.pick);
  if (!h) { tip.hidden = true; return; }
  let html;
  if (h.what === 'robot' || h.what === 'room') {
    // public demo: names only
    html = `<b style="color:${esc(hub().colorOf(h.pick.name))}">${esc(h.pick.name)}</b>`;
  } else if (h.what === 'bridge') html = `<b>SERA</b>`;
  else if (h.what === 'chair') html = `<b>HADI</b>`;
  else if (h.what === 'shuttle') html = `<b>${esc(h.name)}</b>`;
  else html = `<b>${esc(h.room.name)}</b>`;
  tip.innerHTML = html; tip.hidden = false;
  const box = vp.getBoundingClientRect();
  tip.style.left = Math.min(e.clientX - box.left + 14, box.width - tip.offsetWidth - 8) + 'px';
  tip.style.top = Math.min(e.clientY - box.top + 14, box.height - tip.offsetHeight - 8) + 'px';
});
canvas.addEventListener('pointerleave', () => { hover = null; tip.hidden = true; });
// public demo: hover only, no selection

// ── view switch (3D ⇄ Ship, Pixel ⇄ Schematic), remembered per browser ──
const schematicBtn = $('schematicBtn');
function setView(v) {
  view = v === '3d' ? '3d' : 'ship';
  document.querySelectorAll('.vp-switch [data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === view));
  const ship = view === 'ship';
  canvas.hidden = !ship; schematicBtn.hidden = !ship; if (!ship) tip.hidden = true;
  hub().set3D(!ship);
  $('hudLeft').textContent = ship ? (mode === 'schematic' ? 'Top · Schematic' : 'Top · Deck') : 'Perspective';
  if (!ship) $('hudRight').textContent = 'LMB orbit · RMB pan · wheel zoom · F frame · Esc clear';
  cancelAnimationFrame(raf); last = 0;
  if (ship) { resize(); raf = requestAnimationFrame(frame); }
  try { localStorage.setItem('sera.view', view); } catch {}
}
function setMode(m) {
  mode = m === 'schematic' ? 'schematic' : 'pixel';
  schematicBtn.classList.toggle('on', mode === 'schematic'); schematicBtn.setAttribute('aria-pressed', mode === 'schematic');
  if (view === 'ship') $('hudLeft').textContent = mode === 'schematic' ? 'Top · Schematic' : 'Top · Deck';
  try { localStorage.setItem('sera.shipMode', mode); } catch {}
}
document.querySelectorAll('.vp-switch [data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
schematicBtn.addEventListener('click', () => setMode(mode === 'schematic' ? 'pixel' : 'schematic'));

// ── boot ──────────────────────────────────────────────────────
(async () => {
  let saved = {}; try { saved = { v: localStorage.getItem('sera.view'), m: localStorage.getItem('sera.shipMode') }; } catch {}
  setMode(saved.m || 'pixel');
  setView('ship');   // public demo: Ship view only   // Ship is the default main viewport
  await loadAtlas();
  // public demo: roster comes from demo.js
  rebuild();   // app.js may already have loaded the roster before we subscribed
})();

// Test hook (browser console): seraShip.simulate('3d-td') → working for 6 s, then reports back.
window.seraShip = {
  simulate(name, secs = 6) {   // goes through seraViz.agent, i.e. exactly what chat.js calls on Agent tool_use / tool_result
    const fire = on => window.seraViz ? window.seraViz.agent(name, on) : document.dispatchEvent(new CustomEvent('sera:agent', { detail: { name, on } }));
    fire(true); setTimeout(() => fire(false), secs * 1000);
  },
  get unassigned() { return [...unassigned]; },
  get crew() { return crew.map(c => ({ name: c.name, room: c.room.id, desk: c.desk.i, state: c.state, goal: c.goal, busy: c.busy, x: Math.round(c.x), y: Math.round(c.y) })); },
  get delivered() { return delivered; },
  // Page (CSS px) position of a world point, for automated hover/click tests.
  toPage(x, y) { const r = canvas.getBoundingClientRect(), k = r.width / canvas.width; return { x: r.left + (fit.ox + x * fit.s) * k, y: r.top + (fit.oy + y * fit.s) * k }; },
};
