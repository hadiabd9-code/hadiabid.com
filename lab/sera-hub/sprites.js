// SERA Hub Ship view: sprite atlas + placeholder art.
// Real art: drop PNGs + atlas.json into public/ship/ (format documented in projects/sera-hub/CLAUDE.md).
// Anything the atlas doesn't define is painted here in code using the SAME sheet layout,
// so ship.js never knows (or cares) whether it's drawing a placeholder or a real sprite.

export const TILE = 32;

// Robot sheet layout, shared by placeholders and real sheets. Frames face RIGHT; left is mirrored.
// anchor = the feet point inside a frame; hold = where a carried packet sits, relative to the anchor.
export const ROBOT = {
  frame: [24, 28], anchor: [12, 27], hold: [0, -36],
  anims: { idle: { row: 0, frames: 2, fps: 2 }, walk: { row: 1, frames: 4, fps: 8 }, work: { row: 2, frames: 2, fps: 4 } },
};

let atlas = null;
const images = new Map();

// Loads public/ship/atlas.json if it exists. No atlas = all placeholders (the normal case today).
export async function loadAtlas() {
  try {
    return null;   // public demo: placeholder art only
    const r = null;
    if (!r.ok) return null;
    atlas = await r.json();
  } catch { atlas = null; return null; }
  const srcs = new Set();
  (function walk(o) {
    for (const v of Object.values(o || {})) if (v && typeof v === 'object') { if (typeof v.src === 'string') srcs.add(v.src); walk(v); }
  })(atlas);
  await Promise.all([...srcs].map(loadImage));
  sheetCache.clear();
  return atlas;
}

function loadImage(src) {
  // Plain relative .png names only; the server already refuses anything outside public/.
  if (!/^[\w\-./]+\.png$/i.test(src) || src.includes('..')) return Promise.resolve(null);
  return new Promise(ok => {
    const img = new Image();
    img.onload = () => { images.set(src, img); ok(img); };
    img.onerror = () => ok(null);
    img.src = '/ship/' + src;
  });
}

// Optional full-art overrides. Each returns an Image or null (null = draw the placeholder).
export const deckImage = () => images.get(atlas?.deck?.src) || null;
export const roomImage = id => images.get(atlas?.rooms?.[id]?.src) || null;
export function coreSheet() {
  const d = atlas?.core, img = images.get(d?.src);
  return img ? { img, frame: d.frame || [96, 96], anchor: d.anchor || [48, 48], anims: d.anims || {} } : null;
}

// ── robots ────────────────────────────────────────────────────
const sheetCache = new Map();
export function robotSheet(name, color) {
  const key = name + '|' + color;
  if (sheetCache.has(key)) return sheetCache.get(key);
  const def = atlas?.robots?.[name] || atlas?.robots?.default;
  const img = def && images.get(def.src);
  const sheet = img
    ? { img, frame: def.frame || ROBOT.frame, anchor: def.anchor || ROBOT.anchor, hold: def.hold || ROBOT.hold,
        anims: { ...ROBOT.anims, ...(def.anims || {}) }, real: true }
    : { img: paintRobot(name, color), ...ROBOT, real: false };
  sheetCache.set(key, sheet);
  return sheet;
}

// Draws one frame with its anchor at (x, y). phase de-syncs robots so they don't bob in lockstep.
export function drawSprite(ctx, sheet, anim, time, x, y, flip = false, phase = 0) {
  const a = sheet.anims[anim] || sheet.anims.idle;
  const f = Math.floor(time * a.fps + phase) % a.frames;
  const [fw, fh] = sheet.frame, [ax, ay] = sheet.anchor;
  const dx = Math.round(x), dy = Math.round(y);
  if (flip) {
    ctx.save(); ctx.translate(dx, dy); ctx.scale(-1, 1);
    ctx.drawImage(sheet.img, f * fw, a.row * fh, fw, fh, -ax, -ay, fw, fh);
    ctx.restore();
  } else ctx.drawImage(sheet.img, f * fw, a.row * fh, fw, fh, dx - ax, dy - ay, fw, fh);
}

// Role hint per agent: by exact name first, then by keyword so new agents still get something.
const HINTS = { 'job-hunter': 'antenna', 'idea-developer': 'bulb', 'story-writer': 'quill', 'concept-artist': 'brush',
  '3d-td': 'wrench', 'code-dev': 'tablet', 'it-security': 'shield', finance: 'coin' };
export function hintFor(name) {
  if (HINTS[name]) return HINTS[name];
  const k = [[/job|comm|mail/, 'antenna'], [/idea|plan|research/, 'bulb'], [/story|writ/, 'quill'], [/art|design/, 'brush'],
    [/3d|td|unreal|blender/, 'wrench'], [/code|dev/, 'tablet'], [/secur|it-/, 'shield'], [/financ|money|budget/, 'coin']]
    .find(([re]) => re.test(name));
  return k ? k[1] : 'none';
}

// Placeholder robot: blocky body + head + one eye + a role hint, 24x28 frames, rows idle/walk/work.
function paintRobot(name, color) {
  const [fw, fh] = ROBOT.frame, rows = 3, cols = 4;
  const c = document.createElement('canvas'); c.width = fw * cols; c.height = fh * rows;
  const g = c.getContext('2d');
  const hint = hintFor(name);
  const dark = shade(color, 0.45), mid = shade(color, 0.7), light = shade(color, 1.25);
  const OUT = '#0d0e12', METAL = '#c3c8d2', METAL_D = '#8a909c', LEG = '#2c2f37';
  const px = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };

  const frame = (ox, oy, { bob = 0, legA = 0, legB = 0, arm = 0 }) => {
    const P = (x, y, w, h, col) => px(ox + x, oy + y, w, h, col);
    P(6, 25, 12, 2, 'rgba(0,0,0,.35)');                                   // shadow
    P(8, 21 - legA, 3, 5, LEG); P(13, 21 - legB, 3, 5, LEG);              // legs
    P(8, 25 - legA, 4, 1, OUT); P(13, 25 - legB, 4, 1, OUT);              // feet
    const by = 12 + bob;
    P(5, by, 14, 10, OUT); P(6, by + 1, 12, 8, dark); P(6, by + 1, 12, 2, mid);   // body
    P(10, by + 3, 5, 3, hint === 'coin' ? '#f4d35e' : light);             // chest light
    P(3, by + 2, 3, 6, OUT); P(4, by + 3, 1, 4, METAL_D);                 // back arm
    P(10, by - 2, 5, 3, LEG);                                             // neck
    const hy = 3 + bob;
    P(6, hy, 12, 9, OUT); P(7, hy + 1, 10, 7, METAL); P(7, hy + 1, 10, 2, '#dfe3ea');   // head
    P(9, hy + 4, 8, 3, '#14161b');                                        // visor
    P(13, hy + 4, 3, 2, light); P(14, hy + 4, 1, 1, '#ffffff');           // the eye (faces right)
    const ay = by + 2 - arm;
    P(17, ay, 4, 6, OUT); P(18, ay + 1, 2, 4, METAL_D);                   // front arm
    hintArt(P, hint, { hy, ay, color, light, dark });
  };

  for (let i = 0; i < 2; i++) frame(i * fw, 0, { bob: i });                                         // idle
  [[0, 1], [1, 0], [0, 1], [1, 0]].forEach(([a, b], i) =>
    frame(i * fw, fh, { bob: i % 2, legA: i === 0 ? 1 : 0, legB: i === 2 ? 1 : 0 }));               // walk
  for (let i = 0; i < 2; i++) frame(i * fw, fh * 2, { arm: i ? 3 : 0 });                            // work
  return c;
}

function hintArt(P, hint, { hy, ay, color, light, dark }) {
  switch (hint) {
    case 'antenna': P(9, hy - 4, 1, 4, '#8a909c'); P(7, hy - 6, 5, 2, light); P(8, hy - 7, 3, 1, light); break;   // comms dish
    case 'bulb': P(11, hy - 5, 4, 4, '#ffe680'); P(12, hy - 4, 1, 1, '#ffffff'); P(12, hy - 1, 2, 1, '#8a909c'); break;
    case 'quill': P(21, ay - 5, 1, 6, '#f2efe6'); P(22, ay - 7, 1, 4, '#f2efe6'); P(20, ay + 1, 1, 2, '#6b5a3e'); break;
    case 'brush': P(21, ay - 3, 1, 5, '#8b5a2b'); P(21, ay - 6, 2, 3, light); break;
    case 'wrench': P(21, ay, 1, 6, '#9aa1ad'); P(20, ay - 3, 3, 3, '#9aa1ad'); P(21, ay - 2, 1, 1, '#0d0e12'); break;
    case 'tablet': P(19, ay + 4, 5, 4, '#0d0e12'); P(20, ay + 5, 3, 1, '#7ee787'); P(20, ay + 6, 2, 1, '#7ee787'); break;
    case 'shield': P(18, ay - 1, 6, 7, '#0d0e12'); P(19, ay, 4, 5, color); P(20, ay + 5, 2, 1, color); P(20, ay + 1, 2, 2, light); break;
    case 'coin': P(6, hy - 1, 12, 2, '#2f8f4e'); P(15, hy, 4, 1, '#2f8f4e'); break;   // accountant's eyeshade (+ gold chest light)
  }
}

// Colour helpers. Canvas normalizes any CSS colour (hex, hsl…) to #rrggbb for us.
const norm = (() => { const g = document.createElement('canvas').getContext('2d'); return col => { g.fillStyle = '#000'; g.fillStyle = col; return g.fillStyle; }; })();
export function rgb(col) { const h = norm(col); return h.startsWith('#') ? [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)) : [128, 128, 128]; }
export function shade(col, k) { return `rgb(${rgb(col).map(v => Math.max(0, Math.min(255, Math.round(v * k)))).join(',')})`; }
export function mix(a, b, k) { const A = rgb(a), B = rgb(b); return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * k)).join(',')})`; }
export const alpha = (col, a) => `rgba(${rgb(col).join(',')},${a})`;
