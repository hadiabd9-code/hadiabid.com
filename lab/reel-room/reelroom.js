/* Reel Room public demo (hadiabid.com). Built by make_reel_room_demo.py from the private tool. */
(() => {
// default department list; a project can set its own (projects.stages, e.g. h418 = layout, keyframe, gen, comp)
const STAGES = ["layout","animation","lighting","fx","comp"];
const STAGE_LABEL = {board:"Board",animatic:"Animatic",layout:"Layout",keyframe:"Keyframe",gen:"Gen AI",animation:"Animation",
  lighting:"Lighting",fx:"FX",render:"Render",comp:"Comp"};
// per-department status. "done" is the old word for approved (still read, shown as approved)
const STATUS = ["todo","wip","review","redo","approved"];
const STATUS_LABEL = {todo:"to do",wip:"in progress",review:"review",redo:"redo",approved:"approved",done:"approved"};
const stStatus = v => v === "done" ? "approved" : (v || "todo");
// overall shot status (shots.status), separate from the department statuses
const SHOT_STATUS = ["wip","review","redo","approved","final","hold","omit"];
const SHOT_STATUS_LABEL = {wip:"in progress",review:"review",redo:"redo",approved:"approved",final:"final",hold:"on hold",omit:"out of cut"};
// Pipeline order, upstream -> downstream. Single source of truth for version kinds (also in templates/*.json "pipeline").
// "Latest" = the most downstream kind a shot has. slot:true = shown as an empty "not yet" tab on every shot.
const PIPELINE = [
  {kind:"board", label:"Board", slot:true}, {kind:"animatic", label:"Animatic", slot:true}, {kind:"layout", label:"Layout", slot:true},
  {kind:"keyframe", label:"Keyframe"}, {kind:"gen", label:"Gen AI"}, {kind:"render", label:"Render"}, {kind:"comp", label:"Comp"}];
const KINDS = PIPELINE.map(p => p.kind);
const KIND_LABEL = Object.fromEntries(PIPELINE.map(p => [p.kind, p.label]));
const kindRank = k => { const i = KINDS.indexOf(k); return i < 0 ? -1 : i; };   // unknown kinds count as most upstream
const ASTAGES = ["model","surfacing","rig"];
const ASTAGE_LABEL = {model:"Model",surfacing:"Surfacing",rig:"Rig"};
const ATYPES = ["ch","pr","bgp","ext","int","fx"];
const ATYPE_LABEL = {ch:"Character",pr:"Prop",bgp:"BG prop",ext:"Exterior",int:"Interior",fx:"FX"};
const BUILD_LABEL = {requested:"build requested",built:"built",failed:"build failed"};
const BUILD_HINT = "In the full tool, the project builder (Python + Blender) builds requested shots on the studio PC.";

// S.assets = the uploads capability; S.assetRows = the project's asset list (assets collection)
const S = { db:null, user:null, assets:null, me:null, canWrite:null,
  projects:[], pid:null, pendingPid:null, shots:[], versions:[], notes:[], assetRows:[],
  view:"grid", shotId:null, versionId:null, filterStage:"", filterStatus:"", filterShot:"", onlyOpen:false, filterType:"",
  form:{}, edits:{}, compose:null,
  loaded:{projects:false, shots:false, assets:false, versions:false}, unsub:[], readOnly:false };

const app = document.getElementById("app");
const $ = id => document.getElementById(id);
function h(tag, attrs, ...kids){
  const el = document.createElement(tag);
  for (const [k,v] of Object.entries(attrs||{})){
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "text") el.textContent = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
let toastT;
function toast(msg){ const t=$("toast"); t.textContent=msg; t.hidden=false; clearTimeout(toastT); toastT=setTimeout(()=>t.hidden=true,2600); }
const memStore = new Map();  // demo: nothing is saved to the browser
const store = {get(k){return memStore.has(k) ? memStore.get(k) : null}, set(k,v){memStore.set(k,v)}};

const proj = () => S.projects.find(p => p.id === S.pid) || null;
const projStages = () => proj()?.stages?.length ? proj().stages : STAGES;
const stageLabel = k => STAGE_LABEL[k] || ASTAGE_LABEL[k] || k;
const fps = () => proj()?.fps || 30;
const pad3 = n => String(n).padStart(3,"0");
function tc(f){ const r=Math.round(fps()); const s=Math.floor(f/r), fr=f%r; return `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}:${String(fr).padStart(2,"0")}`; }
function mediaSrc(m){ return m.asset ? "/_blob/" + m.asset : (m.src || ""); }
function when(iso){ if(!iso) return ""; const d=new Date(iso); if(isNaN(d)) return ""; return d.toLocaleString(undefined,{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}); }
const openNotesFor = sid => S.notes.filter(n => n.shot === sid && n.status !== "done");
const slug = t => String(t||"").toLowerCase().replace(/\(s\)/g,"").replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"");
const shotNum = code => parseInt(String(code||"").replace(/\D/g,""),10) || 0;
const usedIn = code => S.shots.filter(s => (s.assets||[]).includes(code)).length;
const baseName = p => String(p||"").split(/[\\/]/).pop();
const nowIso = () => new Date().toISOString();
const sortAssets = rows => [...rows].sort((a,b)=>ATYPES.indexOf(a.type)-ATYPES.indexOf(b.type) || (a.sort??0)-(b.sort??0) || String(a.code).localeCompare(String(b.code)));
// form inputs keep what you typed in S.form, so live database updates (which re-render) don't wipe it;
// untouched fields show the default, which can follow the data (e.g. the next free shot code)
function bound(key, def, attrs, ...kids){
  const {tag = "input", after, ...rest} = attrs || {};
  const el = h(tag, {...rest, id:"fm-"+key}, ...kids);
  el.value = key in S.form ? S.form[key] : def;
  el.addEventListener(tag === "select" ? "change" : "input", () => { S.form[key] = el.value; if (after) after(el.value); });
  return el;
}
function buildChip(s){ const b = s.build?.status; return b ? h("span",{class:"bchip","data-b":b, title:s.build.file || s.build.msg || ""}, BUILD_LABEL[b] || b) : null; }
// pipeline order, then n, then oldest first (so tabs read left to right like the pipeline); unknown kinds go last
const tabRank = k => { const i = KINDS.indexOf(k); return i < 0 ? KINDS.length : i; };
const shotVersions = sid => S.versions.filter(v => v.shot === sid).sort((a,b) => tabRank(a.kind)-tabRank(b.kind) || String(a.kind).localeCompare(String(b.kind))
  || (a.n||0)-(b.n||0) || camRank(a)-camRank(b) || (a.created||"").localeCompare(b.created||""));
// within one kind + n: the plain version, then the description-camera clip, then the alt cameras
function camRank(v){ return !v.camera ? 0 : /\(description\)/.test(v.label||"") || v.camera === "CAM_" + String(v.shot||"").split("__").pop() ? 1 : 2; }
const versionLabel = v => v.label || `${KIND_LABEL[v.kind] || v.kind} v${pad3(v.n||0)}`;
// the camera a shot's default output should use: the director's pick, else the description camera
const wantCam = s => s.camera_chosen || s.cameras?.[0] || `CAM_${s.code}`;
// latest(shot) = highest n in the most downstream kind that has media. Ties (same kind + n, e.g. per-camera
// playblasts next to the grey layout preview): chosen camera > description camera > no camera > newest.
// guide:true versions (key-frame guide stills rendered from the layout) are inputs, never the latest output.
function latest(s, vers = S.versions.filter(v => v.shot === s.id)){
  const have = vers.filter(v => v.media?.length && !v.guide);
  if (!have.length) return null;
  const top = Math.max(...have.map(v => kindRank(v.kind)));
  const ofKind = have.filter(v => kindRank(v.kind) === top);
  const n = Math.max(...ofKind.map(v => v.n || 0));
  const want = wantCam(s), desc = `CAM_${s.code}`;
  const score = v => v.camera && v.camera === want ? 3 : v.camera === desc || /\(description\)/.test(v.label||"") ? 2 : !v.camera ? 1 : 0;
  return ofKind.filter(v => (v.n || 0) === n).sort((a,b) => score(b)-score(a) || (b.created||"").localeCompare(a.created||""))[0];
}

/* ---------- header ---------- */
function renderHeader(){
  const sel = $("project");
  sel.replaceChildren(...(S.projects.length ? S.projects.map(p => h("option",{value:p.id, selected:p.id===S.pid}, p.name||p.id)) : [h("option",{},"No projects")]));
  const p = proj();
  // EQ Monolith-style facts (total_frames, bpm, drop) are optional; builder projects show code, fps, resolution
  $("projmeta").textContent = p ? [p.code, p.total_frames && `${(p.total_frames/p.fps).toFixed(0)} s · ${p.total_frames} fr @ ${p.fps} fps`,
    !p.total_frames && p.fps && `${p.fps} fps`, p.res && `${p.res[0]}×${p.res[1]}`,
    p.bpm && `${p.bpm} BPM`, p.drop_f!=null && `drop f${p.drop_f}`].filter(Boolean).join(" · ") : "";
  const ar = p?.res || p?.frame_size;
  if (ar) app.style.setProperty("--ar", `${ar[0]}/${ar[1]}`); else app.style.removeProperty("--ar");
  const oc = S.notes.filter(n => n.status !== "done").length;
  $("opencount").textContent = oc ? oc : "";
  $("assetcount").textContent = S.assetRows.length || "";
  const tab = ["notes","assets","script","genready"].includes(S.view) ? S.view : S.view === "newproject" ? "" : "grid";
  for (const t of ["grid","assets","script","genready","notes"]) $("tab-"+t).setAttribute("aria-pressed", tab === t);
  $("tab-script").hidden = !proj()?.script?.length;
  $("tab-genready").hidden = !S.shots.length;
  $("newproj").hidden = !S.db || S.readOnly;
}

/* ---------- shared bits ---------- */
// kind "shots" = layout..comp chips, "assets" = model/surfacing/rig chips
function stageChips(row, editable, kind = "shots"){
  const list = kind === "assets" ? ASTAGES : projStages();
  return h("div",{class:"stages"}, list.map(k => {
    const s = stStatus(row.stages?.[k]), ap = s === "approved" ? row.approvals?.[k] : null;
    const tip = `${stageLabel(k)}: ${STATUS_LABEL[s]}` + (ap ? ` · ${ap.label ? ap.label + " · " : ""}${when(ap.at)}` : "");
    if (!editable) return h("span",{class:"chip","data-s":s,title:tip}, stageLabel(k), s === "approved" ? " ✓" : null);
    return h("label",{class:"chip","data-s":s, title:tip}, stageLabel(k),
      h("select",{class:"st", disabled:S.readOnly, "aria-label":`${stageLabel(k)} status`, onclick:e=>e.stopPropagation(),
        onchange:e => setStage(row, k, e.target.value, kind)},
        STATUS.map(v => h("option",{value:v, selected:v===s}, STATUS_LABEL[v]))));
  }));
}
function strip(shot){
  const p = proj(); const tot = p?.total_frames || 0;
  if (!tot) return null;
  const el = h("div",{class:"strip", title:`f${shot.in_f}–${shot.out_f} of ${tot}`});
  const i = h("i"); i.style.left = (shot.in_f/tot*100)+"%"; i.style.width = Math.max(.6,(shot.out_f-shot.in_f)/tot*100)+"%"; el.append(i);
  if (p.drop_f != null){ const b=h("b",{title:`Drop f${p.drop_f}`}); b.style.left=(p.drop_f/tot*100)+"%"; el.append(b); }
  return el;
}
function thumb(src, alt){ return src ? h("img",{class:"thumb",src,alt,loading:"lazy"}) : h("div",{class:"thumb empty"},"No image yet"); }
// grid card picture = the shot's latest output: image as is, video as a muted poster frame (#t=0.5), board thumb if it fails
const thumbCache = new Map();   // live re-renders reuse the same node, so poster videos don't reload every db write
function cardThumb(s){
  const v = latest(s), m = v?.media?.[0];
  const key = [s.id, v?.id, m ? mediaSrc(m) : s.thumb, v ? versionLabel(v) : ""].join("|");
  if (thumbCache.get(s.id)?.key === key) return thumbCache.get(s.id).el;
  let pic;
  if (m?.type === "video"){
    pic = h("video",{class:"thumb", src:mediaSrc(m) + "#t=0.5", muted:true, playsinline:true, preload:"metadata", "aria-hidden":"true", tabindex:"-1"});
    pic.muted = true;
    pic.addEventListener("error", () => pic.replaceWith(thumb(s.thumb, `${s.code} board`)), {once:true});
  } else pic = thumb(m ? mediaSrc(m) : s.thumb, `${s.code} ${v ? versionLabel(v) : "board"}`);
  const el = h("div",{class:"thumbwrap"}, pic, v ? h("span",{class:"kindchip", "data-kind":v.kind}, versionLabel(v).replace(/\s·.*$/, "")) : null);
  thumbCache.set(s.id, {key, el});
  return el;
}
function framesText(s){ const d=s.out_f-s.in_f; return `f${pad3(s.in_f)}–${pad3(s.out_f)} · ${d} fr · ${(d/fps()).toFixed(2)} s`; }

/* ---------- grid ---------- */
function renderGrid(){
  let shots = [...S.shots].sort((a,b)=>(a.sort??0)-(b.sort??0) || a.code.localeCompare(b.code));
  if (S.filterStage && S.filterStatus) shots = shots.filter(s => stStatus(s.stages?.[S.filterStage]) === S.filterStatus);
  if (S.filterShot) shots = shots.filter(s => (s.status || "") === (S.filterShot === "none" ? "" : S.filterShot));
  if (S.onlyOpen) shots = shots.filter(s => openNotesFor(s.id).length);
  const p = proj();
  const bar = h("div",{class:"toolbar"},
    h("label",{for:"f-stage"},"Stage"),
    h("select",{id:"f-stage", onchange:e=>{S.filterStage=e.target.value; render();}},
      h("option",{value:""},"Any"), projStages().map(k=>h("option",{value:k,selected:S.filterStage===k},stageLabel(k)))),
    h("select",{id:"f-status", "aria-label":"Status", disabled:!S.filterStage, onchange:e=>{S.filterStatus=e.target.value; render();}},
      h("option",{value:""},"Any status"), STATUS.map(k=>h("option",{value:k,selected:S.filterStatus===k},STATUS_LABEL[k]))),
    h("label",{for:"f-shot"},"Shot"),
    h("select",{id:"f-shot", onchange:e=>{S.filterShot=e.target.value; render();}},
      h("option",{value:""},"Any"), h("option",{value:"none",selected:S.filterShot==="none"},"no status"),
      SHOT_STATUS.map(k=>h("option",{value:k,selected:S.filterShot===k},SHOT_STATUS_LABEL[k]))),
    h("label",{for:"f-open", style:"display:flex;gap:6px;align-items:center;text-transform:none;letter-spacing:0;font-size:14px;color:var(--fg)"},
      h("input",{type:"checkbox", id:"f-open", checked:S.onlyOpen, onchange:e=>{S.onlyOpen=e.target.checked; render();}}), "Only shots with open notes"),
    S.shots.length ? h("button",{class:"btn primary", id:"play-cut", style:"margin-left:auto", title:"Every shot's latest version, back to back", onclick:()=>go("cut")},"Play full cut") : null,
    p?.animatic ? h("button",{class:"btn", title:"The animatic as one file", onclick:()=>{S.cut="animatic"; go("animatic");}},"Animatic") : null,
    p?.layout_cut ? h("button",{class:"btn", title:"The layout cut as one file", onclick:()=>{S.cut="layout"; go("animatic");}},"Layout cut") : null,
    p?.gen_cut ? h("button",{class:"btn", title:"The Gen AI rough cut as one file", onclick:()=>{S.cut="gen"; go("animatic");}},"Gen cut") : null,
    S.shots.length && !S.readOnly ? buildAllButton("") : null
  );
  if (S.loaded.projects && !p) return [h("div",{class:"empty"},h("strong",{},"No projects yet"),
    h("span",{}, S.readOnly ? "No projects in this demo." : "Use + New project at the top to make one."))];
  const requested = S.shots.filter(s => s.build?.status === "requested").length;
  const hint = requested ? h("p",{class:"hint",style:"margin:-6px 0 14px"}, `${requested} shot${requested>1?"s":""} waiting for a build. ${BUILD_HINT}`) : null;
  const adder = p && !S.readOnly && S.loaded.shots ? addShotsPanel(p) : null;
  if (!S.loaded.shots) return [bar, h("div",{class:"empty"},h("strong",{},"Loading shots"))];
  if (!S.shots.length) return [bar, adder, h("div",{class:"empty"},h("strong",{},"No shots in this project yet"),
    h("span",{}, S.readOnly ? "Shots are imported from a storyboard board.json."
      : "Use Add shots above, or import them from a storyboard board.json."))];
  if (!shots.length) return [bar, hint, adder, h("div",{class:"empty"},h("strong",{},"No shots match these filters"))];
  return [bar, hint, adder, h("div",{class:"grid"}, shots.map(s => {
    const on = openNotesFor(s.id).length;
    return h("button",{class:"card", "data-st":s.status||"", onclick:()=>go("shot",s.id), "aria-label":`${s.code} ${s.title}`},
      cardThumb(s),
      h("div",{class:"body"},
        h("div",{class:"cardhead"}, h("span",{class:"code"},s.code), h("span",{class:"title"},s.title),
          s.status ? h("span",{class:"sstat","data-st":s.status}, SHOT_STATUS_LABEL[s.status] || s.status) : null, on ? h("span",{class:"badge"},`${on} open`) : null),
        h("div",{class:"frames mono",style:"display:flex;flex-wrap:wrap;gap:6px 8px;align-items:center"}, framesText(s), buildChip(s),
          (s.cameras||[]).length > 1 ? h("span",{class:"bchip", title:"Cameras: " + s.cameras.join(", ")}, `${s.cameras.length} cams`) : null),
        strip(s),
        stageChips(s,false)));
  }))];
}

function buildAllButton(style){
  const todo = S.shots.filter(s => !["requested","built"].includes(s.build?.status));
  const b = h("button",{class:"btn", style, disabled:!todo.length, title:BUILD_HINT, onclick:async ()=>{
    b.disabled = true;
    try{
      const at = nowIso();
      await Promise.all(todo.map(s => S.db.doc("shots/"+s.id).update({build:{status:"requested", file:s.build?.file||"", at, msg:""}})));
      toast(`${todo.length} shot${todo.length>1?"s":""} marked for build. In the full tool the project builder picks them up.`);
    }catch(e){ writeFailed(e); b.disabled = false; }
  }}, todo.length ? `Build all unbuilt (${todo.length})` : "All shots built or requested");
  return b;
}
// make shots back to back: SH010, SH020, ... each `len` frames (out_f is exclusive, like the board import)
function addShotsPanel(p){
  const step0 = p.shot_step || 10;
  const lastNum = Math.max(0, ...S.shots.map(s => shotNum(s.code)));
  const nextStart = S.shots.length ? Math.max(...S.shots.map(s => s.out_f||0)) : (p.frame_start ?? 1);
  if (S.form.addPid !== p.id) { for (const k of ["shCount","shFirst","shStep","shLen","shStart"]) delete S.form[k]; S.form.addPid = p.id; }
  const count = bound("shCount", "5", {type:"number", min:1, max:200, class:"n"});
  const first = bound("shFirst", "SH" + pad3(lastNum ? lastNum + step0 : step0), {class:"n mono"});
  const step = bound("shStep", String(step0), {type:"number", min:1, class:"n"});
  const len = bound("shLen", "48", {type:"number", min:1, class:"n"});
  const start = bound("shStart", String(nextStart), {type:"number", class:"n"});
  const make = h("button",{class:"btn primary", onclick:async ()=>{
    const n = +count.value, st = +step.value, ln = +len.value; let f = +start.value;
    const m = first.value.trim().toUpperCase().match(/^([A-Z_]*)(\d+)$/);
    if (!m || !(n >= 1 && n <= 200) || !(st >= 1) || !(ln >= 1) || !Number.isFinite(f)) { toast("Check the fields: first code like SH010, count 1-200, step and length at least 1."); return; }
    const width = Math.max(3, m[2].length), have = new Set(S.shots.map(s => s.code));
    const stages = Object.fromEntries((p.stages || STAGES).map(k => [k,"todo"]));
    make.disabled = true; let made = 0, skipped = 0;
    try{
      for (let i = 0; i < n; i++){
        const num = +m[2] + i*st, code = (m[1] || "SH") + String(num).padStart(width,"0");
        if (have.has(code)) { skipped++; continue; }
        await S.db.doc(`shots/${p.id}__${code}`).set({ project:p.id, code, title:"", sort:num, in_f:f, out_f:f+ln,
          stages, assets:[], build:{status:"", file:"", at:"", msg:""}, thumb:"", created:nowIso() });
        f += ln; made++;
      }
      for (const k of ["shFirst","shStart"]) delete S.form[k];  // next defaults follow the new last shot
      toast(`${made} shot${made===1?"":"s"} added` + (skipped ? `, ${skipped} already existed` : ""));
    }catch(e){ writeFailed(e); }
    make.disabled = false; render();
  }}, "Add shots");
  const lab = (t, el) => h("label",{}, t, el);
  return h("details",{class:"panel", open:!S.shots.length || S.form.shOpen === "1", ontoggle:e => S.form.shOpen = e.target.open ? "1" : ""},
    h("summary",{},"Add shots"),
    h("div",{class:"form"}, lab("How many",count), lab("First code",first), lab("Step",step), lab("Length (frames)",len), lab("Start frame",start), make),
    h("span",{class:"hint"}, `Shots go back to back from the start frame. Codes count up by the step (SH010, SH020...). ${p.fps||24} fps, so 48 frames = ${(48/(p.fps||24)).toFixed(1)} s.`));
}

/* ---------- shot page ---------- */
async function renderShot(){
  const s = S.shots.find(x => x.id === S.shotId);
  if (!s) return [h("button",{class:"link back",onclick:()=>go("grid")},"← All shots"), h("div",{class:"empty"},h("strong",{},"Shot not found"))];
  const vers = shotVersions(s.id);
  const top = latest(s, vers);
  // opens on the latest output and keeps following it (new version, new camera pick) until someone picks a tab
  if (S.loaded.versions && (!S.versionPicked || !vers.find(v=>v.id===S.versionId))) { S.versionId = top?.id || vers[0]?.id || null; S.versionPicked = false; }
  const cur = vers.find(v=>v.id===S.versionId);
  const idx = S.shots.slice().sort((a,b)=>(a.sort??0)-(b.sort??0)); const i = idx.findIndex(x=>x.id===s.id);
  const prev = idx[i-1], next = idx[i+1];
  if (S.compose && S.compose.shot !== s.id) clearCompose();
  const camList = cameraSet(s, vers);
  const cams = camsPanel(s, camList);   // before the composer: in A/B it sets the note's default version

  const viewer = h("section",{class:"viewer","aria-label":"Versions"},
    versionTabs(s, vers, top),
    approveBar(s, cur),
    cur ? h("div",{class:"media"}, (cur.media||[]).map(m => {
      const el = m.type === "video" ? h("video",{src:mediaSrc(m), controls:true, playsinline:true, preload:"metadata"}) : h("img",{src:mediaSrc(m), alt:m.caption||cur.label||""});
      const draw = canDraw() ? h("button",{class:"btn drawbtn", title: m.type === "video" ? "Draw on the current frame (pauses the video)" : "Draw over this image",
        onclick:()=>startDraw(s, cur, m, el)}, "Draw") : null;
      return h("figure",{}, el, m.caption || draw ? h("div",{class:"figbar"}, m.caption ? h("figcaption",{},m.caption) : h("span",{style:"flex:1"}), draw) : null);
    })) : null,
    h("dl",{class:"facts"},
      h("dt",{},"Frames"), h("dd",{class:"mono"}, `${framesText(s)} · ${tc(s.in_f)} → ${tc(s.out_f)}`),
      s.bars ? [h("dt",{},"Bars"), h("dd",{},s.bars)] : null,
      s.camera ? [h("dt",{},"Camera"), h("dd",{},s.camera)] : null,
      s.cameras?.length || camList.length > 1 ? [h("dt",{},"Camera chosen"), h("dd",{},
        h("span",{class:"mono"}, chosenCam(s, camList)),
        s.camera_chosen_at ? h("span",{class:"muted"}, ` · picked ${when(s.camera_chosen_at)}`) : h("span",{class:"muted"}, " · default (description camera)"))] : null,
      s.action ? [h("dt",{},"Action"), h("dd",{},s.action)] : null,
      s.script?.length ? [h("dt",{},"Script"), h("dd",{}, scriptList(s.script))] : null,
      s.sync ? [h("dt",{},"Sync"), h("dd",{},s.sync)] : null,
      s.tool ? [h("dt",{},"Tool"), h("dd",{}, s.tool + (s.tool_note ? ` (${s.tool_note})` : ""))] : null,
      cur ? [h("dt",{},"Made by"), h("dd",{}, await personName(cur.made_by))] : null),
    h("p",{class:"hint"},"New versions (image or video upload) are off in this public demo.")
  );

  const notes = S.notes.filter(n => n.shot === s.id).sort((a,b)=> (a.status==="done")-(b.status==="done") || (b.created||"").localeCompare(a.created||""));
  const ps = await profilesFor(notes);
  const draftKey = "sg-draft-" + s.id;
  const ta = h("textarea",{id:"note-text", placeholder: S.readOnly ? "You can read notes on this page but not add them." : "Write a note on this shot…", disabled:S.readOnly,
    oninput:e=>store.set(draftKey,e.target.value)});
  ta.value = store.get(draftKey) || "";
  // S.compose keeps the version/frame picks and an attached drawing across live re-renders (it's per shot)
  const cp = S.compose || {};
  const keepC = (k, v) => { S.compose = {...(S.compose || {shot:s.id}), [k]:v}; };
  const verSel = h("select",{id:"note-version","aria-label":"Note is about", onchange:e=>keepC("version", e.target.value)}, h("option",{value:""},"Whole shot"),
    vers.map(v => h("option",{value:v.id, selected: "version" in cp ? v.id===cp.version : v.id===S.versionId}, v.label||v.kind)));
  const frameIn = h("input",{id:"note-frame", class:"frame mono", type:"number", min:s.in_f, max:s.out_f, placeholder:"frame", "aria-label":"Frame (optional)",
    oninput:e=>keepC("frame", e.target.value)});
  if (cp.frame != null) frameIn.value = cp.frame;
  const ann = cp.ann || null;
  const chip = ann ? h("div",{class:"annchip"}, picEl(ann.thumb, "Attached drawing"), "Drawing attached",
    h("button",{title:"Remove the drawing", "aria-label":"Remove the drawing", onclick:()=>{ keepC("ann", null); render(); }}, "✕")) : null;
  const post = h("button",{class:"btn primary", disabled:S.readOnly, onclick:async ()=>{
    const text = ta.value.trim() || (ann ? "(drawing)" : ""); if (!text) { ta.focus(); return; }
    post.disabled = true;
    try{
      const doc = { project:S.pid, shot:s.id, version:verSel.value, text,
        frame: frameIn.value === "" ? null : Number(frameIn.value), author:S.me, status:"open", created:new Date().toISOString() };
      if (ann) doc.annotation = ann.doc;
      await S.db.collection("notes").add(doc);
      store.set(draftKey,""); ta.value = ""; clearCompose(); toast("Note added");
    }catch(e){ writeFailed(e); post.disabled = false; }
  }}, "Add note");

  const notesEl = h("section",{class:"notes","aria-label":"Notes"},
    h("h3",{},`Notes · ${notes.filter(n=>n.status!=="done").length} open`),
    h("div",{class:"compose"}, ta, chip, h("div",{class:"row"}, verSel, frameIn, h("span",{style:"flex:1"}), post)),
    notes.length ? h("ul",{class:"thread"}, notes.map(n => noteItem(n, ps, vers))) : h("div",{class:"muted"},"No notes on this shot yet.")
  );

  return [
    h("div",{class:"toolbar"}, h("button",{class:"link",onclick:()=>go("grid")},"← All shots"), h("span",{style:"flex:1"}),
      prev ? h("button",{class:"btn",onclick:()=>go("shot",prev.id)},`← ${prev.code}`) : null,
      next ? h("button",{class:"btn",onclick:()=>go("shot",next.id)},`${next.code} →`) : null),
    h("div",{class:"shothead"}, h("h1",{},s.code), h("h2",{},s.title), strip(s) ? h("div",{style:"flex-basis:100%"}, strip(s)) : null),
    shotStatusBar(s),
    h("div",{class:"shotlayout"}, cams ? h("div",{class:"side"}, viewer, cams) : viewer, h("div",{class:"side"}, shotSetup(s), notesEl))
  ];
}
// version tabs in pipeline order; Board/Animatic/Layout always show, as a greyed "not yet" slot until a version exists
function versionTabs(s, vers, top){
  const tabs = [];
  for (const k of [...KINDS, ...new Set(vers.map(v => v.kind).filter(k => !KINDS.includes(k)))]){
    const ofKind = vers.filter(v => v.kind === k);
    if (!ofKind.length){
      if (PIPELINE.find(p => p.kind === k)?.slot) tabs.push(h("span",{class:"vtab slot", "aria-disabled":"true", title:`No ${KIND_LABEL[k].toLowerCase()} version yet`}, `${KIND_LABEL[k]}: not yet`));
      continue;
    }
    for (const v of ofKind) tabs.push(h("button",{class:"vtab", "data-version":v.id, "aria-pressed":String(v.id===S.versionId),
      onclick:()=>{ S.versionId = v.id; S.versionPicked = true; render(); }},
      versionLabel(v), v.id === top?.id ? h("span",{class:"latest"},"latest") : null, h("small",{},when(v.created))));
  }
  return h("div",{class:"vtabs",role:"group","aria-label":"Pick a version"}, tabs);
}
// shot setup: title + frame range, which assets go in the shot, and the Blender build request
function shotSetup(s){
  const ro = S.readOnly, rows = sortAssets(S.assetRows), have = new Set(s.assets || []);
  const known = new Set(rows.map(a => a.code)), stray = [...have].filter(c => !known.has(c));
  const kids = [h("h3",{},"Shot setup")];

  if (!ro){
    // edits only stick once you type, so live changes from others still show until then
    const e = S.edits[s.id] || {title:s.title || "", in_f:String(s.in_f ?? ""), out_f:String(s.out_f ?? "")};
    const inp = (key, attrs) => { const el = h("input",{...attrs, id:`ed-${key}`}); el.value = e[key]; el.addEventListener("input",()=>{ S.edits[s.id] = e; e[key] = el.value; }); return el; };
    const save = h("button",{class:"btn", onclick:async ()=>{
      const a = +e.in_f, b = +e.out_f;
      if (!Number.isFinite(a) || !Number.isFinite(b) || e.in_f === "" || e.out_f === "" || b <= a) { toast("Out must be after In."); return; }
      try { await S.db.doc("shots/"+s.id).update({title:e.title.trim(), in_f:a, out_f:b}); delete S.edits[s.id]; toast("Shot saved"); }
      catch(err){ writeFailed(err); }
    }}, "Save");
    kids.push(h("div",{class:"form"},
      h("label",{class:"grow"},"Title", inp("title",{type:"text", placeholder:"What happens in this shot"})),
      h("label",{},"In", inp("in_f",{type:"number", class:"n mono"})),
      h("label",{},"Out", inp("out_f",{type:"number", class:"n mono", title:"First frame after the shot (length = Out - In)"})),
      save));
  }

  kids.push(h("div",{class:"hint"}, `Assets in this shot (${have.size})`));
  if (!rows.length && !stray.length) kids.push(h("div",{class:"muted",style:"font-size:13px"}, "No assets in this project yet. ",
    h("button",{class:"link",onclick:()=>go("assets")},"Add them in the Assets tab"), "."));
  else if (ro) kids.push(h("div",{style:"font-size:14px"}, have.size ? [...have].map(c => rows.find(a=>a.code===c)?.name || c).join(", ") : "None yet."));
  else {
    const toggle = async (code, on) => {
      const next = new Set(have); on ? next.add(code) : next.delete(code);
      const order = rows.map(a => a.code).filter(c => next.has(c)).concat(stray.filter(c => next.has(c)));
      try { await S.db.doc("shots/"+s.id).update({assets:order}); } catch(err){ writeFailed(err); }
    };
    kids.push(h("div",{class:"checks"},
      rows.map(a => h("label",{title:a.code}, h("input",{type:"checkbox", checked:have.has(a.code), onchange:ev=>toggle(a.code, ev.target.checked)}), a.name || a.code, h("small",{},a.type))),
      stray.map(c => h("label",{title:"Not in the asset list"}, h("input",{type:"checkbox", checked:true, onchange:ev=>toggle(c, ev.target.checked)}), c, h("small",{},"missing")))));
  }

  const b = s.build || {}, st = b.status || "";
  const req = h("button",{class:"btn primary", disabled:st === "requested", onclick:async ()=>{
    req.disabled = true;
    try { await S.db.doc("shots/"+s.id).update({build:{status:"requested", file:b.file||"", at:nowIso(), msg:""}}); toast("Build requested. In the full tool the project builder picks it up."); }
    catch(err){ writeFailed(err); req.disabled = false; }
  }}, st === "requested" ? "Build requested" : st === "built" ? "Request rebuild" : "Build shot");
  kids.push(h("div",{style:"display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;border-top:1px solid var(--line);padding-top:10px"},
    h("span",{class:"hint"},"Blender file"), buildChip(s) || h("span",{class:"bchip"},"not built yet"),
    b.at ? h("span",{class:"hint"}, when(b.at)) : null, h("span",{style:"flex:1"}), ro ? null : req));
  if (b.file) kids.push(h("div",{class:"path", title:b.file}, b.file));
  if (b.msg) kids.push(h("div",{class:"hint"}, b.msg));
  if (!ro) kids.push(h("div",{class:"hint"}, BUILD_HINT + " The file links the ticked assets and gets this shot's frame range."));
  return h("section",{class:"panel","aria-label":"Shot setup"}, kids);
}
function noteItem(n, ps, vers, withShot){
  const p = n.author ? ps[n.author] : null;
  const v = (vers||S.versions).find(x => x.id === n.version);
  const s = withShot ? S.shots.find(x=>x.id===n.shot) : null;
  return h("li",{class:"note","data-status":n.status},
    h("div",{class:"who"}, p ? h("img",{src:p.avatarUrl,alt:""}) : null, h("strong",{}, p ? (p.name||"Someone") : (n.author_label||n.author||"Someone")),
      h("span",{}, when(n.created)),
      s ? h("button",{class:"link",onclick:()=>go("shot",s.id)}, s.code) : null,
      v ? h("span",{},`on ${v.label||v.kind}`) : null,
      n.frame!=null ? h("span",{class:"mono"},`f${n.frame}`) : null,
      h("span",{class:`pill ${n.status==="done"?"done":"open"}`}, n.status==="done"?"done":"open")),
    h("div",{class:"txt"}, n.text),
    n.annotation?.src ? h("button",{class:"annthumb", title:"Open the drawing", onclick:()=>openLightbox(n.annotation.src)},
      picEl(n.annotation.src, "Drawing on this note", {loading:"lazy"})) : null,
    S.readOnly ? null : h("div",{class:"acts"},
      h("button",{class:"link", onclick:()=>setNoteStatus(n, n.status==="done"?"open":"done")}, n.status==="done" ? "Reopen" : "Mark done")));
}
function uploadForm(s, vers){
  const kind = h("select",{id:"up-kind","aria-label":"Version type"}, PIPELINE.map(p=>h("option",{value:p.kind},p.label)));
  const file = h("input",{id:"up-file", type:"file", accept:"image/*,video/*", "aria-label":"Image or video, up to 20 MB"});
  const go_ = h("button",{class:"btn", onclick:async ()=>{
    const f = file.files[0]; if (!f) { file.click(); return; }
    if (f.size > 20*1024*1024) { toast("That file is over 20 MB. Upload a smaller proxy; keep the master in the project folder."); return; }
    go_.disabled = true; go_.textContent = "Uploading…";
    try{
      const up = await S.assets.upload(f);
      const k = kind.value; const n = Math.max(0, ...vers.filter(v=>v.kind===k).map(v=>v.n||0)) + 1;
      const id = `${s.id}__${k}_v${pad3(n)}`;
      await S.db.doc("versions/"+id).set({ project:S.pid, shot:s.id, kind:k, n, label:`${KIND_LABEL[k] || k} v${pad3(n)}`,
        media:[{type: f.type.startsWith("video") ? "video" : "image", asset: up.id, caption: f.name}], made_by:S.me, created:new Date().toISOString() });
      S.versionId = id; S.versionPicked = true; toast("Version added");
    }catch(e){ toast(e?.code==="too_large" ? "That file is over the upload limit." : "Upload failed. Try again."); }
    go_.disabled = false; go_.textContent = "Add version";
  }}, "Add version");
  return h("div",{class:"upload"}, h("span",{class:"muted"},"New version:"), kind, file, go_);
}

/* ---------- multi-camera review ---------- */
// A camera clip is its own version with a `camera` field, so notes and drawings attach to it like any version.
// The panel is built once per (shot, mode, picks, chosen) and reused across live re-renders: the same video
// nodes go back into the page, so playback isn't reset every time someone else writes to the database.
function cameraSet(s, vers){
  const groups = new Map();
  for (const v of vers) if (v.camera && v.media?.[0]) { const k = `${v.kind}|${v.n}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(v); }
  const best = [...groups.values()].filter(g => g.length > 1).sort((a,b) => (b[0].n||0)-(a[0].n||0))[0] || [];
  const order = s.cameras || [], rank = c => { const i = order.indexOf(c); return i < 0 ? 1e6 : i; };
  return [...best].sort((a,b) => rank(a.camera)-rank(b.camera) || /\(description\)/.test(b.label||"")-/\(description\)/.test(a.label||"") || a.camera.localeCompare(b.camera));
}
const chosenCam = (s, list) => s.camera_chosen || s.cameras?.[0] || list[0]?.camera || "";
// the note composer's version follows the clip on screen in A/B (and the clip drawn on, via startDraw)
function setComposeVersion(sid, vid){
  if (S.compose?.shot === sid && S.compose.ann) return;   // an attached drawing keeps the note on the version it was drawn on
  S.compose = {...(S.compose && S.compose.shot === sid ? S.compose : {shot:sid}), version:vid};
  const sel = $("note-version"); if (sel) sel.value = vid;
}
async function chooseCamera(s, cam, btn){
  if (btn) btn.disabled = true;
  try { await S.db.doc("shots/"+s.id).update({camera_chosen:cam, camera_chosen_by:S.me || "", camera_chosen_at:nowIso()}); toast(`${cam} is the camera for ${s.code}`); }
  catch(e){ writeFailed(e); if (btn) btn.disabled = false; }
}

function camsPanel(s, list){
  if (list.length < 2) return null;
  let c = S.cam;
  if (!c || c.shot !== s.id) { c?.player?.destroy(); c = S.cam = {shot:s.id, mode:"compare", a:list[0].id, b:list[1].id, show:"a"}; }
  if (!list.some(v => v.id === c.a)) c.a = list[0].id;
  if (!list.some(v => v.id === c.b) || c.b === c.a) c.b = list.find(v => v.id !== c.a).id;
  const chosen = chosenCam(s, list);
  const key = [c.mode, c.a, c.b, chosen, S.readOnly, canDraw(), list.map(v => v.id + ":" + mediaSrc(v.media[0])).join(",")].join("|");
  if (c.el && c.key === key) return c.el;
  const keep = c.player?.state(); c.player?.destroy();
  const byId = id => list.find(v => v.id === id);
  const shownId = () => c.mode === "ab" ? c[c.show] : null;

  const mkVideo = v => { const el = h("video",{src:mediaSrc(v.media[0]), playsinline:true, preload:"auto", "aria-label":v.camera}); el.dataset.version = v.id; return el; };
  // name + Chosen badge + Draw + Use this camera, under each clip
  const clipBar = (v, el) => h("div",{class:"figbar"},
    h("span",{class:"camname", style:"flex:1;min-width:0"}, v.camera), v.camera === chosen ? h("span",{class:"chosen"},"Chosen") : null,
    canDraw() ? h("button",{class:"btn drawbtn", title:"Draw on the current frame of this camera (pauses playback)",
      onclick:()=>{ player.pause(); startDraw(s, v, v.media[0], el); }}, "Draw") : null,
    !S.readOnly && v.camera !== chosen ? h("button",{class:"btn", onclick:e=>chooseCamera(s, v.camera, e.currentTarget)}, "Use this camera") : null);

  let stage, videos, abBar = null;
  if (c.mode === "compare"){
    const va = mkVideo(byId(c.a)), vb = mkVideo(byId(c.b)); vb.muted = true;   // same audio slice in both: play one
    videos = [va, vb];
    stage = h("div",{class:"campair"}, [[byId(c.a), va], [byId(c.b), vb]].map(([v, el]) => h("figure",{}, el, clipBar(v, el))));
  } else {
    const v = byId(c[c.show]), el = mkVideo(v);
    videos = [el];
    abBar = h("div",{}, clipBar(v, el));
    stage = h("div",{class:"camab"}, h("figure",{}, el, abBar));
  }
  const player = makePlayer(s, videos);

  // A/B: same video element, new source, same time and play state
  async function showSlot(slot){
    if (c.mode !== "ab" || c.show === slot) return;
    c.show = slot;
    const v = byId(c[slot]), el = videos[0], t = el.currentTime, playing = !el.paused;
    el.pause(); el.src = mediaSrc(v.media[0]); el.dataset.version = v.id; el.setAttribute("aria-label", v.camera);
    abBar.replaceChildren(clipBar(v, el));
    syncButtons(); setComposeVersion(s.id, v.id);
    await once(el, ["loadedmetadata","error"], 6000);
    el.currentTime = Math.min(t, el.duration || t);
    await once(el, ["seeked"], 3000);
    player.update();
    if (playing) player.play();
  }
  const camBtns = list.map(v => h("button",{class:"cambtn", "data-version":v.id, onclick:()=>{
    if (v.id === c.a || v.id === c.b) { if (c.mode === "ab") showSlot(v.id === c.a ? "a" : "b"); return; }
    // a camera that isn't picked yet replaces B (or, in A/B, the slot that's not on screen)
    const slot = c.mode === "ab" ? (c.show === "a" ? "b" : "a") : "b";
    c[slot] = v.id; if (c.mode === "ab") c.show = slot;
    render();
  }}, v.camera, h("span",{class:"slot", hidden:true}), v.camera === chosen ? h("span",{class:"chosen"},"Chosen") : null));
  function syncButtons(){
    for (const b of camBtns){
      const id = b.dataset.version, slot = id === c.a ? "A" : id === c.b ? "B" : "";
      const sl = b.querySelector(".slot"); sl.hidden = !slot; sl.textContent = slot;
      b.setAttribute("aria-pressed", c.mode === "ab" ? id === shownId() : !!slot);
    }
    if (abToggle) abToggle.textContent = c.show === "a" ? "Show B" : "Show A";
  }
  const modeBtn = (m, lab) => h("button",{class:"vtab", "aria-pressed":String(c.mode === m), onclick:()=>{ if (c.mode === m) return; c.mode = m; render(); }}, lab);
  const abToggle = c.mode === "ab" ? h("button",{class:"btn", id:"cam-abswitch", onclick:()=>showSlot(c.show === "a" ? "b" : "a")}, "") : null;

  const el = h("section",{class:"panel", "aria-label":"Cameras"},
    h("div",{class:"figbar"}, h("h3",{style:"flex:1"}, `Cameras · ${list.length}`),
      h("div",{class:"vtabs", role:"group", "aria-label":"Camera view"}, modeBtn("compare","Compare"), modeBtn("ab","A/B"))),
    h("div",{class:"camrow", role:"group", "aria-label":"Cameras"}, camBtns),
    stage,
    h("div",{class:"transport"}, player.controls, abToggle),
    h("div",{class:"hint"}, c.mode === "compare" ? "A on the left, B on the right, one transport for both. Click another camera to put it in B."
      : "One frame: switch between A and B at the same moment. Click another camera to swap it in."));
  syncButtons();
  if (c.mode === "ab" && !(S.compose?.shot === s.id && S.compose.version === c[c.show] )) setComposeVersion(s.id, c[c.show]);
  if (keep) player.restore(keep);
  c.el = el; c.key = key; c.player = player;
  return el;
}

// one play/pause + scrub for 1 or 2 videos; the first video is the master clock, the others follow it
function makePlayer(s, videos){
  const m = videos[0], f = 1 / fps();
  const playB = h("button",{class:"btn", id:"cam-play", onclick:()=> m.paused || m.ended ? api.play() : api.pause()}, "Play");
  const scrub = h("input",{type:"range", id:"cam-scrub", min:0, max:1000, step:1, value:0, "aria-label":"Scrub both cameras"});
  const read = h("span",{class:"mono hint", id:"cam-frame"}, "");
  const frameAt = t => s.in_f + Math.round(t * fps());
  let dragging = false;
  scrub.addEventListener("input", () => { dragging = true; const t = (+scrub.value / 1000) * (m.duration || 0); videos.forEach(v => { v.currentTime = t; }); show(t); });
  scrub.addEventListener("change", () => { dragging = false; });
  const show = t => { read.textContent = `f${frameAt(t)} · ${t.toFixed(2)} s`; if (!dragging && m.duration) scrub.value = Math.round(t / m.duration * 1000); };
  const update = () => { show(m.currentTime); playB.textContent = m.paused || m.ended ? "Play" : "Pause"; };
  const others = () => videos.slice(1);
  // paused: exact seek. Playing: a seek lands late by its own latency, so big drifts seek a little ahead
  // and small ones are closed by nudging the (muted) follower's speed for a moment
  const resync = () => { for (const o of others()){
    if (o.seeking) continue;
    const d = o.currentTime - m.currentTime;
    if (m.paused) { o.playbackRate = 1; if (Math.abs(d) > f/2) o.currentTime = m.currentTime; }
    else if (Math.abs(d) > 0.25) { o.playbackRate = 1; o.currentTime = Math.min(o.duration || Infinity, m.currentTime + 0.06); }
    else if (Math.abs(d) > f/2) o.playbackRate = Math.min(1.25, Math.max(0.75, 1 - d * 3));
    else o.playbackRate = 1;
  }};
  m.addEventListener("timeupdate", update); m.addEventListener("loadedmetadata", update);
  m.addEventListener("play", update); m.addEventListener("pause", update);
  m.addEventListener("ended", () => { others().forEach(o => o.pause()); update(); });
  m.addEventListener("seeked", () => { if (m.paused) resync(); });
  // drift check: every 250 ms while playing, pull the followers back if they're more than a frame off
  const tick = setInterval(() => { if (!m.isConnected) return; if (!m.paused) { resync(); show(m.currentTime); } }, 250);
  const api = {
    controls: [playB, scrub, read],
    async play(){
      if (m.ended || m.currentTime >= (m.duration || Infinity) - f/2) videos.forEach(v => { v.currentTime = 0; });
      resync();
      try { await Promise.all(videos.map(v => v.play())); } catch { videos.forEach(v => v.pause()); toast("The browser blocked playback. Press Play again."); }
      update();
    },
    pause(){ videos.forEach(v => v.pause()); resync(); update(); },
    update,
    state(){ return {t:m.currentTime || 0, playing:!m.paused && !m.ended}; },
    async restore(st){
      if (m.readyState < 1) await once(m, ["loadedmetadata","error"], 6000);
      videos.forEach(v => { v.currentTime = Math.min(st.t, v.duration || st.t); });
      update(); if (st.playing) api.play();
    },
    destroy(){ clearInterval(tick); videos.forEach(v => v.pause()); },
  };
  return api;
}

/* ---------- draw-over ---------- */
// Strokes are kept in image pixels (the PNG's own size), so the note's stroke data is display-independent.
const DRAW_COLORS = [["red","#ff3b30"],["yellow","#ffd60a"],["cyan","#32d7ff"],["white","#ffffff"]];
const DRAW_TOOLS = [["pen","Pen"],["arrow","Arrow"],["circle","Circle"],["box","Box"],["text","Text"]];
const DRAW_MAX_SIDE = 2560;    // bigger frames are scaled down so the PNG stays a sensible upload
const DRAW_MAX_POINTS = 6000;  // total stroke points per drawing, keeps the note doc far under 200 KB
const canDraw = () => !!S.assets && !!S.db && !S.readOnly;
function clearCompose(){ S.compose = null; }
// demo: a drawing lives in memory; paint it on a canvas instead of an <img> with a blob: URL
function picEl(src, alt, attrs){
  if (!String(src).startsWith("demo-blob:")) return h("img",{src, alt, ...(attrs||{})});
  const cv = h("canvas",{role:"img", "aria-label":alt, style:"max-width:100%;height:auto;display:block"});
  const b = window.ReelRoomDemo?.blob(src);
  if (b) createImageBitmap(b).then(bm => { cv.width = bm.width; cv.height = bm.height; cv.getContext("2d").drawImage(bm, 0, 0); });
  return cv;
}
const once = (el, evs, ms) => new Promise(res => { const t = setTimeout(res, ms); evs.forEach(ev => el.addEventListener(ev, () => { clearTimeout(t); res(); }, {once:true})); });

async function startDraw(shot, ver, m, el){
  let src = el, frame = null;
  if (m.type === "video"){
    el.pause();
    if (el.readyState < 2) { el.currentTime = el.currentTime || 0.001; await once(el, ["seeked","loadeddata"], 4000); }
    if (el.readyState < 2 || !el.videoWidth) { toast("Couldn't grab this frame yet. Play or scrub the video, then press Draw."); return; }
    frame = Math.min(shot.out_f, Math.max(shot.in_f, shot.in_f + Math.round(el.currentTime * fps())));
  } else if (!el.complete || !el.naturalWidth) {
    await once(el, ["load","error"], 8000);
    if (!el.naturalWidth) { toast("The image hasn't loaded, so there's nothing to draw on."); return; }
  }
  const nw = m.type === "video" ? el.videoWidth : el.naturalWidth, nh = m.type === "video" ? el.videoHeight : el.naturalHeight;
  const k = Math.min(1, DRAW_MAX_SIDE / Math.max(nw, nh)), w = Math.round(nw*k), hgt = Math.round(nh*k);
  const base = document.createElement("canvas"); base.width = w; base.height = hgt;
  base.getContext("2d").drawImage(src, 0, 0, w, hgt);
  drawEditor({shot, ver, base, w, h:hgt, frame, media_src: m.asset ? "/_blob/" + m.asset : (m.src || "")});
}

function drawStroke(ctx, st){
  ctx.strokeStyle = ctx.fillStyle = st.color; ctx.lineWidth = st.width || 4; ctx.lineCap = ctx.lineJoin = "round";
  const p = st.points || [];
  if (st.tool === "text"){
    const size = st.size || 32;
    ctx.font = `600 ${size}px Barlow, system-ui, sans-serif`; ctx.textBaseline = "top";
    ctx.lineWidth = Math.max(2, size/7); ctx.strokeStyle = "rgba(0,0,0,.75)";
    ctx.strokeText(st.text, st.x, st.y); ctx.fillText(st.text, st.x, st.y); return;
  }
  if (!p.length) return;
  ctx.beginPath();
  if (st.tool === "pen"){
    ctx.moveTo(p[0][0], p[0][1]);
    if (p.length === 1) ctx.lineTo(p[0][0] + .1, p[0][1]);   // a tap still leaves a dot
    for (const q of p.slice(1)) ctx.lineTo(q[0], q[1]);
    ctx.stroke(); return;
  }
  const [a, b] = [p[0], p[p.length-1]];
  if (st.tool === "box") ctx.strokeRect(Math.min(a[0],b[0]), Math.min(a[1],b[1]), Math.abs(b[0]-a[0]), Math.abs(b[1]-a[1]));
  else if (st.tool === "circle") { ctx.ellipse((a[0]+b[0])/2, (a[1]+b[1])/2, Math.abs(b[0]-a[0])/2, Math.abs(b[1]-a[1])/2, 0, 0, Math.PI*2); ctx.stroke(); }
  else if (st.tool === "arrow"){
    const ang = Math.atan2(b[1]-a[1], b[0]-a[0]), hl = Math.max(12, ctx.lineWidth*4);
    ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
    ctx.moveTo(b[0] - hl*Math.cos(ang - .45), b[1] - hl*Math.sin(ang - .45)); ctx.lineTo(b[0], b[1]);
    ctx.lineTo(b[0] - hl*Math.cos(ang + .45), b[1] - hl*Math.sin(ang + .45));
    ctx.stroke();
  }
}

function drawEditor(o){
  const {w, h:hh} = o;
  const thin = Math.max(2, Math.round(Math.max(w, hh) / 320)), WIDTHS = [thin, Math.round(thin * 2.5)];
  const ed = {tool:"pen", color:DRAW_COLORS[0][1], width:WIDTHS[0], strokes:[], undo:[], cur:null, pid:null};
  const cv = h("canvas",{width:w, height:hh, "aria-label":"Drawing canvas"}), ctx = cv.getContext("2d");
  const stage = h("div",{class:"drawstage"}, cv);
  const total = () => ed.strokes.reduce((n, st) => n + (st.points?.length || 1), 0);
  const paint = () => { ctx.drawImage(o.base, 0, 0); for (const st of ed.strokes) drawStroke(ctx, st); if (ed.cur) drawStroke(ctx, ed.cur); syncBtns(); };
  const commit = st => { ed.undo.push(ed.strokes); ed.strokes = [...ed.strokes, st]; };
  const fit = () => {
    const aw = stage.clientWidth - 16, ah = stage.clientHeight - 16, k = Math.min(aw / w, ah / hh);
    if (k > 0) { cv.style.width = Math.floor(w*k) + "px"; cv.style.height = Math.floor(hh*k) + "px"; }
  };
  const toImg = e => { const r = cv.getBoundingClientRect(); return [Math.round((e.clientX - r.left) * w / r.width), Math.round((e.clientY - r.top) * hh / r.height)]; };

  // pressed-state buttons: one group each for tool, colour and width
  const pick = (list, key, mk) => { const bs = list.map(([v, lab]) => { const b = mk(v, lab); b.addEventListener("click", () => { ed[key] = v; bs.forEach(x => x.setAttribute("aria-pressed", x === b)); }); return b; });
    bs[0].setAttribute("aria-pressed", "true"); return h("div",{class:"grp", role:"group"}, bs); };
  const tools = pick(DRAW_TOOLS, "tool", (v, lab) => h("button",{class:"dbtn", "aria-pressed":"false", "data-tool":v}, lab));
  const colors = pick(DRAW_COLORS.map(([n, c]) => [c, n]), "color", (c, n) => { const b = h("button",{class:"dbtn swatch", "aria-pressed":"false", title:n, "aria-label":n, "data-color":n}, h("i")); b.style.setProperty("--sw", c); return b; });
  const widths = pick(WIDTHS.map((v, i) => [v, i ? "Thick" : "Thin"]), "width", (v, lab) => h("button",{class:"dbtn", "aria-pressed":"false", "data-width":lab.toLowerCase()}, lab));
  const undoB = h("button",{class:"dbtn", title:"Undo (Ctrl+Z)", onclick:()=>undo()}, "Undo");
  const clearB = h("button",{class:"dbtn", onclick:()=>{ if (!ed.strokes.length) return; ed.undo.push(ed.strokes); ed.strokes = []; paint(); }}, "Clear");
  const cancelB = h("button",{class:"dbtn", onclick:()=>close()}, "Cancel");
  const saveB = h("button",{class:"dbtn primary", onclick:()=>save()}, "Save");
  function syncBtns(){ undoB.disabled = !ed.undo.length; clearB.disabled = !ed.strokes.length; saveB.disabled = !ed.strokes.length; }
  const label = o.shot.code + (o.frame != null ? ` · f${o.frame}` : "");
  const ov = h("div",{class:"drawov", role:"dialog", "aria-modal":"true", "aria-label":`Draw on ${label}`},
    h("div",{class:"drawbar"}, h("span",{class:"drawtitle"}, label), tools, h("span",{class:"sep"}), colors, h("span",{class:"sep"}), widths,
      h("span",{class:"sep"}), undoB, clearB, h("span",{style:"flex:1"}), cancelB, saveB), stage);

  function undo(){ if (ed.undo.length) { ed.strokes = ed.undo.pop(); paint(); } }
  let textIn = null;
  function askText(pt, e){
    // an inline box instead of prompt(): sandboxed frames can block prompt()
    const r = stage.getBoundingClientRect();
    textIn = h("input",{class:"label", type:"text", placeholder:"Label, then Enter", "aria-label":"Label text"});
    textIn.style.left = Math.min(e.clientX - r.left, r.width - 180) + "px"; textIn.style.top = Math.min(e.clientY - r.top, r.height - 48) + "px";
    const done = keep => { if (!textIn) return; const el = textIn; textIn = null; const t = el.value.trim(); el.remove();   // clear first: remove() fires blur
      if (keep && t) { commit({tool:"text", color:ed.color, x:pt[0], y:pt[1], text:t.slice(0, 200), size:Math.round(thin * 9)}); paint(); } };
    textIn.addEventListener("keydown", ev => { if (ev.key === "Enter") { ev.preventDefault(); done(true); } else if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); done(false); } });
    textIn.addEventListener("blur", () => done(true));
    stage.append(textIn); setTimeout(() => textIn?.focus(), 0);
  }

  cv.addEventListener("pointerdown", e => {
    if (ed.pid != null || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.preventDefault();
    if (textIn) { textIn.blur(); return; }
    const pt = toImg(e);
    if (ed.tool === "text") { askText(pt, e); return; }
    if (total() >= DRAW_MAX_POINTS) { toast("That's a lot of drawing. Save this one and start another."); return; }
    ed.pid = e.pointerId; try { cv.setPointerCapture(e.pointerId); } catch {}
    ed.cur = {tool:ed.tool, color:ed.color, width:ed.width, points:[pt]}; paint();
  });
  cv.addEventListener("pointermove", e => {
    if (e.pointerId !== ed.pid || !ed.cur) return;
    const pt = toImg(e), p = ed.cur.points;
    if (ed.tool === "pen"){
      const l = p[p.length-1];
      if (Math.hypot(pt[0]-l[0], pt[1]-l[1]) < 2 || total() + p.length >= DRAW_MAX_POINTS) return;   // simplify: drop near-duplicate points
      p.push(pt);
    } else ed.cur.points = [p[0], pt];
    paint();
  });
  const end = e => {
    if (e.pointerId !== ed.pid) return;
    ed.pid = null; const st = ed.cur; ed.cur = null;
    // shapes need some size; a pen tap is kept as a dot
    if (st && (st.tool === "pen" || Math.hypot(st.points[1]?.[0] - st.points[0][0], st.points[1]?.[1] - st.points[0][1]) >= 3)) commit(st);
    paint();
  };
  cv.addEventListener("pointerup", end); cv.addEventListener("pointercancel", end);

  const onKey = e => {
    if (e.target === textIn) return;
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); }
  };
  function close(){ document.removeEventListener("keydown", onKey, true); window.removeEventListener("resize", fit); ov.remove(); document.body.style.overflow = ""; }

  async function save(){
    if (!ed.strokes.length) return;
    textIn?.blur(); ed.cur = null; paint();
    saveB.disabled = true; saveB.textContent = "Saving…";
    let blob = null;
    try { blob = await new Promise((res, rej) => { try { cv.toBlob(b => b ? res(b) : rej(new Error("empty")), "image/png"); } catch (err) { rej(err); } }); }
    catch (err) { toast(err?.name === "SecurityError" ? "Can't draw on this one (the image comes from another site)." : "Couldn't make the picture. Try again."); saveB.textContent = "Save"; syncBtns(); return; }
    try{
      const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "");
      const up = await S.assets.upload(new File([blob], `${o.shot.code}_note_${stamp}.png`, {type:"image/png"}));
      const strokes = ed.strokes.map(st => st.tool === "text" ? {tool:"text", color:st.color, x:st.x, y:st.y, text:st.text, size:st.size}
        : {tool:st.tool, color:st.color, width:st.width, points:st.points.map(q => [Math.round(q[0]), Math.round(q[1])])});
      // keep whatever the composer already had (typed text lives in the draft), point it at this version + frame
      clearCompose();
      S.compose = {shot:o.shot.id, version:o.ver.id, frame:o.frame, ann:{thumb:up.id,
        doc:{asset:up.id, src:up.id, w, h:hh, version:o.ver.id, media_src:o.media_src, frame:o.frame, strokes}}};
      close(); toast("Drawing attached. Add a note to post it."); await render();
      $("note-text")?.focus();
    }catch(e){ toast(e?.code === "too_large" ? "The drawing is over the upload limit." : "Upload failed. Try again."); saveB.textContent = "Save"; syncBtns(); }
  }

  document.body.append(ov); document.body.style.overflow = "hidden";
  document.addEventListener("keydown", onKey, true); window.addEventListener("resize", fit);
  fit(); paint();
}

function openLightbox(src){
  const close = () => { document.removeEventListener("keydown", onKey, true); lb.remove(); document.body.style.overflow = ""; };
  const onKey = e => { if (e.key === "Escape") { e.preventDefault(); close(); } };
  const lb = h("div",{class:"lightbox", role:"dialog", "aria-modal":"true", "aria-label":"Drawing", onclick:close},
    h("div",{class:"drawbar"}, h("span",{class:"drawtitle"},"Drawing"), h("span",{style:"flex:1"}),
      String(src).startsWith("demo-blob:") ? null : h("a",{class:"dbtn", href:src, target:"_blank", rel:"noopener", style:"display:grid;place-items:center;text-decoration:none;color:inherit", onclick:e=>e.stopPropagation()}, "Open in new tab"),
      h("button",{class:"dbtn"}, "Close")),
    h("div",{class:"drawstage"}, picEl(src, "Drawing on this note")));
  document.body.append(lb); document.body.style.overflow = "hidden"; document.addEventListener("keydown", onKey, true);
}

/* ---------- assets ---------- */
function renderAssets(){
  const p = proj();
  if (S.loaded.projects && !p) return [h("div",{class:"empty"},h("strong",{},"No projects yet"))];
  const all = sortAssets(S.assetRows);
  const rows = S.filterType ? all.filter(a => a.type === S.filterType) : all;
  const bar = h("div",{class:"toolbar"},
    h("label",{for:"f-type"},"Type"),
    h("select",{id:"f-type", onchange:e=>{S.filterType=e.target.value; render();}},
      h("option",{value:""},`All types (${all.length})`),
      ATYPES.map(t => h("option",{value:t, selected:S.filterType===t}, `${ATYPE_LABEL[t]} (${all.filter(a=>a.type===t).length})`))));
  const kids = [bar];
  if (!S.readOnly && p) kids.push(addAssetPanel(p, all));
  if (!S.loaded.assets) kids.push(h("div",{class:"empty"},h("strong",{},"Loading assets")));
  else if (!all.length) kids.push(h("div",{class:"empty"},h("strong",{},"No assets in this project yet"),
    h("span",{}, S.readOnly ? "No asset list yet." : "Add characters, props and sets above. Then tick them on each shot page.")));
  else if (!rows.length) kids.push(h("div",{class:"empty"},h("strong",{},"No assets of this type")));
  else kids.push(h("ul",{class:"alist"}, rows.map(a => {
    const n = usedIn(a.code);
    return h("li",{class:"arow"},
      h("span",{class:"acode"}, a.code),
      h("span",{class:"aname"}, a.name || a.code),
      h("span",{class:"pill", title:a.type}, ATYPE_LABEL[a.type] || a.type),
      stageChips(a, true, "assets"),
      h("span",{class:"hint"}, `used in ${n} shot${n===1?"":"s"}`),
      a.file ? h("span",{class:"path", title:a.file}, baseName(a.file)) : null);
  })));
  return kids;
}
function addAssetPanel(p, all){
  // the code follows the name until you edit the code yourself
  const code = bound("asCode", "", {class:"mono", placeholder:"auto", after:()=>S.form.asCodeTouched = "1"});
  const name = bound("asName", "", {class:"w", placeholder:"e.g. Record disc", after:v=>{ if (!S.form.asCodeTouched) { S.form.asCode = slug(v); code.value = S.form.asCode; } }});
  const type = bound("asType", "pr", {tag:"select"}, ATYPES.map(t => h("option",{value:t}, `${ATYPE_LABEL[t]} (${t})`)));
  const add = h("button",{class:"btn primary", onclick:async ()=>{
    const nm = name.value.trim(), cd = slug(code.value || nm);
    if (!nm || !cd) { toast("Give the asset a name."); name.focus(); return; }
    if (all.some(a => a.code === cd)) { toast(`There is already an asset called ${cd}.`); return; }
    add.disabled = true;
    try{
      await S.db.doc(`assets/${p.id}__${cd}`).set({ project:p.id, code:cd, name:nm, type:type.value,
        sort:Math.max(0, ...all.map(a => a.sort||0)) + 10, stages:Object.fromEntries(ASTAGES.map(k=>[k,"todo"])), file:"", created:nowIso() });
      for (const k of ["asName","asCode","asCodeTouched"]) delete S.form[k];
      toast(`Added ${cd}`);
    }catch(e){ writeFailed(e); }
    add.disabled = false; render();
  }}, "Add asset");
  return h("section",{class:"panel"}, h("h3",{},"Add asset"),
    h("div",{class:"form"}, h("label",{class:"grow"},"Name",name), h("label",{},"Code",code), h("label",{},"Type",type), add),
    h("span",{class:"hint"},`Files will be named ${p.code||"PROJ"}_<code>_<stage>_v###.blend. Codes are lower case with underscores.`));
}

/* ---------- new project ---------- */
function renderNewProject(){
  const initials = v => v.trim().split(/\s+/).filter(Boolean).map(w => w[0]).join("").toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,4);
  const code = bound("npCode", "", {class:"n mono", placeholder:"NS", after:()=>S.form.npCodeTouched = "1"});
  const name = bound("npName", "", {class:"w", placeholder:"e.g. Night Shift", after:v=>{ if (!S.form.npCodeTouched) { S.form.npCode = initials(v); code.value = S.form.npCode; } }});
  const fps = bound("npFps", "24", {type:"number", min:1, step:"any", class:"n"});
  const w = bound("npW", "3840", {type:"number", min:16, class:"n"});
  const hh = bound("npH", "2160", {type:"number", min:16, class:"n"});
  const fs = bound("npStart", "1", {type:"number", class:"n"});
  const step = bound("npStep", "10", {type:"number", min:1, class:"n"});
  const root = bound("npRoot", "", {class:"w mono", placeholder:"<PROJECT_ROOT>"});
  const tpl = bound("npTpl", "generic", {class:"mono"});
  const make = h("button",{class:"btn primary", onclick:async ()=>{
    const nm = name.value.trim(), cd = code.value.trim().toUpperCase();
    if (!nm) { toast("Give the project a name."); name.focus(); return; }
    if (!/^[A-Z][A-Z0-9]{0,7}$/.test(cd)) { toast("Code: 1-8 letters or digits, starting with a letter (e.g. AP)."); code.focus(); return; }
    const pid = cd.toLowerCase();
    if (S.projects.some(p => p.id === pid)) { toast(`A project with code ${cd} already exists.`); return; }
    if (!(+fps.value > 0) || !(+w.value > 0) || !(+hh.value > 0)) { toast("Check fps and resolution."); return; }
    make.disabled = true; S.pendingPid = pid;
    try{
      await S.db.doc("projects/"+pid).set({ name:nm, code:cd, fps:+fps.value, res:[+w.value, +hh.value],
        frame_start:+fs.value || 0, root:root.value.trim(), template:tpl.value.trim() || "generic",
        shot_step:+step.value || 10, stages:STAGES, sort:Math.max(0, ...S.projects.map(p => p.sort||0)) + 10,
        created:nowIso(), created_by:S.me || "" });
      for (const k of Object.keys(S.form)) if (k.startsWith("np")) delete S.form[k];
      toast(`Project ${cd} created. Add shots and assets next.`);
      if (S.pid !== pid && S.projects.some(p => p.id === pid)) { S.pid = pid; S.pendingPid = null; store.set("sg-project", pid); subscribeProject(pid); }
      go("grid");
    }catch(e){ S.pendingPid = null; writeFailed(e); make.disabled = false; }
  }}, "Create project");
  const lab = (t, el, cls) => h("label",{class:cls}, t, el);
  return [h("div",{class:"toolbar"}, h("button",{class:"link",onclick:()=>go("grid")},"← Back")),
    h("section",{class:"panel"}, h("h3",{},"New project"),
      h("div",{class:"form"}, lab("Name",name,"grow"), lab("Code",code)),
      h("div",{class:"form"}, lab("FPS",fps), lab("Width",w), lab("Height",hh), lab("Start frame",fs), lab("Shot step",step)),
      h("div",{class:"form"}, lab("Root folder (studio PC)",root,"grow"), lab("Template",tpl)),
      h("div",{class:"form"}, make),
      h("span",{class:"hint"},"No shots needed to start. The code goes in every file name (NS_SH010_layout_v001.blend). The root and template are used by the project builder on the studio PC. Demo: the project only lives in this tab."))];
}

/* ---------- open notes ---------- */
async function renderOpenNotes(){
  const open = S.notes.filter(n => n.status !== "done").sort((a,b)=>{
    const sa=S.shots.find(x=>x.id===a.shot)?.sort??0, sb=S.shots.find(x=>x.id===b.shot)?.sort??0; return sa-sb || (b.created||"").localeCompare(a.created||""); });
  if (!open.length) return [h("div",{class:"empty"},h("strong",{},"No open notes"),h("span",{},"Notes you add on a shot page show up here until someone marks them done."))];
  const ps = await profilesFor(open);
  const byShot = new Map(); for (const n of open){ if(!byShot.has(n.shot)) byShot.set(n.shot,[]); byShot.get(n.shot).push(n); }
  return [h("ul",{class:"onlist"}, [...byShot].map(([sid, ns]) => {
    const s = S.shots.find(x=>x.id===sid);
    return h("li",{class:"onrow"},
      h("button",{class:"link",style:"text-decoration:none",onclick:()=>go("shot",sid),"aria-label":`Open ${s?.code||"shot"}`}, thumb(s?.thumb, s?.code||"")),
      h("div",{style:"display:grid;gap:8px;min-width:0"},
        h("div",{class:"cardhead"}, h("button",{class:"link code",style:"text-decoration:none",onclick:()=>go("shot",sid)}, s?.code||"?"), h("span",{class:"title"}, s?.title||"")),
        h("ul",{class:"thread"}, ns.map(n => noteItem(n, ps)))));
  }))];
}

/* ---------- script ---------- */
const secs = t => `${Number(t).toFixed(1)} s`;
function scriptList(lines, withShots){
  return h("ul",{class:"script"}, lines.map(l => h("li",{"data-who":l.who==="Narrator"?"vo":"crew"},
    h("span",{class:"mono st"}, `${secs(l.t_in)}–${secs(l.t_out)}`),
    h("span",{class:"who"}, l.who + (l.cont ? " (cont.)" : "")),
    h("span",{class:"txt"}, `“${l.text}”`),
    withShots && l.shots?.length ? h("span",{class:"shots"}, l.shots.map(sc => {
      const s = S.shots.find(x => x.code === sc);
      return s ? h("button",{class:"link mono",onclick:()=>go("shot",s.id)}, sc) : h("span",{class:"mono"},sc);
    })) : null)));
}
function renderScript(){
  const p = proj();
  if (!p?.script?.length) return [h("div",{class:"empty"},h("strong",{},"No script for this project yet"),h("span",{},"It comes from the shot list and the animatic subtitles."))];
  const vo = p.script.filter(l=>l.who==="Narrator"), words = p.script.reduce((n,l)=>n+l.text.split(/\s+/).length,0);
  return [h("section",{class:"viewer"},
    h("h2",{style:"margin:0;font:600 22px/1.1 var(--display)"},`${p.name} · script`),
    h("div",{class:"muted",style:"font-size:13px"}, `${p.script.length} lines (${vo.length} narration, ${p.script.length-vo.length} crew/radio) · ${words} words${p.script_source ? " · from " + p.script_source : ""}`),
    scriptList(p.script, true))];
}

/* ---------- gen ready (read only) ---------- */
// projects can point at their key-frame prompts file (projects.prompts_file); none in the demo
const PROMPTS_DEFAULT = {};
const promptsFile = p => p?.prompts_file || PROMPTS_DEFAULT[p?.id] || "";
const guideFor = sid => S.versions.filter(v => v.shot === sid && v.guide && v.media?.length).sort((a,b)=>(b.n||0)-(a.n||0))[0] || null;
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
// ready for key-frame generation = all five checks pass; notes count only when a person wrote them (not the supervisor's layout pass)
function genChecks(s){
  const open = S.notes.filter(n => n.shot === s.id && n.status !== "done" && n.author !== "Supervisor").length;
  const g = guideFor(s.id), lines = s.script?.length || 0;
  return [
    {key:"layout", ok: s.layout_approved === true || stStatus(s.stages?.layout) === "approved", label:"Layout approved", bad:"layout not approved"},
    {key:"notes", ok: !open, label: open ? plural(open, "open note") : "No open notes", bad: plural(open, "open note")},
    {key:"camera", ok: !!s.camera_chosen, label: s.camera_chosen ? s.camera_chosen : "No camera chosen", bad:"no camera chosen"},
    {key:"guide", ok: !!g, label: g ? `Key guide v${pad3(g.n||0)}` : "No key guide", bad:"no key guide"},
    {key:"script", ok: lines > 0, label: lines ? plural(lines, "script line") : "No script lines", bad:"no script lines"}];
}
function renderGenReady(){
  const p = proj(), pf = promptsFile(p);
  const shots = [...S.shots].sort((a,b)=>(a.sort??0)-(b.sort??0) || a.code.localeCompare(b.code));
  if (!shots.length) return [h("div",{class:"empty"},h("strong",{},"No shots yet"),h("span",{},"Add shots first."))];
  const rows = shots.map(s => ({s, checks: genChecks(s)}));
  const ready = rows.filter(r => r.checks.every(c => c.ok)).length;
  return [h("section",{class:"viewer"},
    h("div",{class:"gensum"},
      h("span",{class:"big", id:"gen-summary"}, `${ready} of ${shots.length} ready`),
      h("span",{class:"muted",style:"font-size:13px"}, "Ready = layout approved, no open notes by a person, camera chosen, key guide, script lines. Read only.")),
    pf ? h("div",{class:"genprompts"}, "Prompts: ", h("span",{class:"mono"}, pf)) : null,
    h("ul",{class:"onlist", "aria-label":"Shots and generation checks"}, rows.map(({s, checks}) => {
      const ok = checks.every(c => c.ok), g = guideFor(s.id);
      const pic = g?.media?.find(m => m.type === "image" && /first_grey/.test(mediaSrc(m))) || g?.media?.[0];
      return h("li",{}, h("button",{class:"genrow", "data-ready":String(ok), "data-shot":s.code, onclick:()=>go("shot", s.id),
          "aria-label":`Open ${s.code}: ${ok ? "ready" : "blocked"}`},
        thumb(pic ? mediaSrc(pic) : s.thumb, `${s.code} ${g ? "key guide" : "board"}`),
        h("div",{style:"display:grid;gap:8px;min-width:0"},
          h("div",{class:"cardhead"}, h("span",{class:"code"}, s.code), h("span",{class:"title"}, s.title||"")),
          h("div",{class:"genchecks"}, checks.map(c => h("span",{class:"gck","data-ok":String(c.ok),"data-check":c.key}, c.label))),
          h("div",{class:"genverdict","data-ready":String(ok)}, ok ? "Ready" : "Blocked: " + checks.filter(c => !c.ok).map(c => c.bad).join(", ")),
          pf ? h("div",{class:"genprompts"}, "Prompts: ", h("span",{class:"mono", title:pf}, `${baseName(pf)} · ${s.code}`)) : null)));
    })))];
}

/* ---------- animatic ---------- */
function renderAnimatic(){
  const p = proj();
  return [h("div",{class:"toolbar"}, h("button",{class:"link",onclick:()=>go("grid")},"← All shots")),
    h("section",{class:"viewer"}, h("h2",{style:"margin:0;font:600 22px/1.1 var(--display)"},`${p?.name||""} · ${S.cut==="gen" && p?.gen_cut ? "Gen AI rough cut" : S.cut==="layout" && p?.layout_cut ? "layout cut" : "full animatic"}`),
      (S.cut==="gen" && p?.gen_cut) || (S.cut==="layout" && p?.layout_cut) || p?.animatic ? h("video",{src:(S.cut==="gen" && p?.gen_cut) || (S.cut==="layout" && p?.layout_cut) || p.animatic, controls:true, playsinline:true, preload:"metadata", style:"width:100%;border-radius:4px;background:#000"}) : h("div",{class:"muted"},"No animatic yet."),
      h("div",{class:"muted",style:"font-size:13px"},"Web proxy, silent in this demo. Masters stay in the project folder."))];
}

/* ---------- full cut (playlist of every shot's latest output) ---------- */
// Two <video> elements take turns: one plays, the other preloads the next clip and is swapped in on "ended",
// so cuts are close to gapless. Image versions (boards) are held for the shot's length, silent.
// The player is built once per playlist and reused across live re-renders, like the cameras panel.
const mmss = t => `${String(Math.floor(t/60)).padStart(2,"0")}:${String(Math.floor(t%60)).padStart(2,"0")}`;
function cutItems(){
  const f = fps();
  return [...S.shots].filter(s => s.status !== "omit").sort((a,b)=>(a.sort??0)-(b.sort??0) || a.code.localeCompare(b.code)).map(s => {
    const v = latest(s), m = v?.media?.[0];
    return {s, v, type: m?.type === "video" ? "video" : "image", src: m ? mediaSrc(m) : (s.thumb || ""),
      label: v ? versionLabel(v) : "No version yet", dur: Math.max(0.5, ((s.out_f ?? 0) - (s.in_f ?? 0)) / f)};
  });
}
function stopCut(){ const P = S.cutP; if (!P) return; P.playing = false; P.vids.forEach(v => v.pause()); clearInterval(P.tick); S.cutP = null; }

function renderCut(){
  const p = proj();
  const items = cutItems();
  const key = S.pid + "|" + items.map(it => [it.s.id, it.v?.id, it.src, it.type, it.dur].join(":")).join(",");
  const head = [h("div",{class:"toolbar"}, h("button",{class:"link",onclick:()=>go("grid")},"← All shots"), h("span",{style:"flex:1"}),
    p?.animatic ? h("button",{class:"btn", onclick:()=>{S.cut="animatic"; go("animatic");}},"Animatic (one file)") : null,
    p?.layout_cut ? h("button",{class:"btn", onclick:()=>{S.cut="layout"; go("animatic");}},"Layout cut (one file)") : null,
    p?.gen_cut ? h("button",{class:"btn", onclick:()=>{S.cut="gen"; go("animatic");}},"Gen cut (one file)") : null)];
  if (!items.length) return [...head, h("div",{class:"empty"},h("strong",{},"No shots to play yet"))];
  if (S.cutP?.key === key) return [...head, S.cutP.el];
  const keepShot = S.cutP?.items[S.cutP.i]?.s.id; stopCut();

  const P = S.cutP = {key, items, i:0, playing:false, primed:false, act:null, hold:0, holdT0:0, tick:null};
  const total = items.reduce((t, it) => t + it.dur, 0), startOf = i => items.slice(0, i).reduce((t, it) => t + it.dur, 0);
  const mkVid = () => { const v = h("video",{playsinline:true, preload:"auto", class:"cutmedia", hidden:true}); v.muted = false; return v; };
  P.vids = [mkVid(), mkVid()];
  const img = h("img",{class:"cutmedia", alt:"", hidden:true});
  const blank = h("div",{class:"cutmedia cutblank", hidden:true}, "No version yet");
  const codeEl = h("span",{class:"code", id:"cut-code"}), labEl = h("span",{class:"mono", id:"cut-label"}), countEl = h("span",{class:"mono muted", id:"cut-count"});
  const timeEl = h("span",{class:"mono hint", id:"cut-time"});
  const bar = h("i"), prog = h("div",{class:"strip", title:"Position in the cut"}, bar);
  const playB = h("button",{class:"btn primary", id:"cut-play", onclick:()=> P.playing ? pause() : play()}, "Play");
  const prevB = h("button",{class:"btn", id:"cut-prev", onclick:()=>jump(P.i - 1)}, "← Prev");
  const nextB = h("button",{class:"btn", id:"cut-next", onclick:()=>jump(P.i + 1)}, "Next →");
  const list = items.map((it, i) => h("button",{class:"cutshot", "data-i":i, onclick:()=>jump(i), title:`${it.s.code} · ${it.label}`},
    h("span",{class:"code"}, it.s.code), h("span",{class:"kindchip", "data-kind":it.v?.kind || ""}, it.v ? it.label.replace(/\s·.*$/, "") : "none")));

  const elapsedInShot = () => { const it = items[P.i];
    if (it.type === "video" && P.act) return Math.min(it.dur, P.act.currentTime || 0);
    return Math.min(it.dur, P.hold + (P.playing && P.holdT0 ? (performance.now() - P.holdT0) / 1000 : 0)); };
  function ui(){
    const it = items[P.i];
    codeEl.textContent = it.s.code; labEl.textContent = it.label; countEl.textContent = `${P.i + 1} / ${items.length}`;
    const t = startOf(P.i) + elapsedInShot();
    timeEl.textContent = `${mmss(t)} / ${mmss(total)}`; bar.style.left = "0"; bar.style.width = (t / total * 100) + "%";
    playB.textContent = P.playing ? "Pause" : P.i === items.length - 1 && P.done ? "Play again" : "Play";
    prevB.disabled = P.i === 0; nextB.disabled = P.i === items.length - 1;
    list.forEach((b, i) => b.setAttribute("aria-current", String(i === P.i)));
  }
  // load clip i into a video element (no-op if it's already there)
  function prep(vid, i){ if (vid.dataset.idx === String(i)) return; vid.dataset.idx = String(i); vid.src = items[i].src; vid.load(); }
  function show(i){
    const it = items[i]; P.i = i; P.done = false; P.hold = 0; P.holdT0 = 0;
    const was = P.act;
    if (it.type === "video" && it.src){
      const vid = P.vids.find(v => v.dataset.idx === String(i) && v !== was) || P.vids.find(v => v !== was) || P.vids[0];
      prep(vid, i); if (vid.currentTime > 0) vid.currentTime = 0;
      P.act = vid; vid.hidden = false; img.hidden = blank.hidden = true;
      P.vids.forEach(v => { if (v !== vid) { v.pause(); v.hidden = true; } });
    } else {
      P.act = null; P.vids.forEach(v => { v.pause(); v.hidden = true; });
      if (it.src) { img.src = it.src; img.alt = `${it.s.code} ${it.label}`; img.hidden = false; blank.hidden = true; }
      else { img.hidden = true; blank.hidden = false; }
    }
    // preload the next clip into the free element while this one plays
    const nx = items[i + 1];
    if (nx?.type === "video" && nx.src) prep(P.vids.find(v => v !== P.act), i + 1);
    if (P.playing) run();
    ui();
  }
  function run(){
    if (P.act) P.act.play().catch(() => { P.playing = false; ui(); toast("The browser blocked playback. Press Play to continue."); });
    else P.holdT0 = performance.now();
  }
  function advance(){ if (P.i + 1 < items.length) show(P.i + 1); else { P.playing = false; P.done = true; ui(); } }
  function play(){
    if (P.done) { P.playing = true; show(0); return; }
    // iOS wants each media element started from a tap once: start + stop the standby one muted
    if (!P.primed) { P.primed = true; const sb = P.vids.find(v => v !== P.act);
      if (sb?.src) { sb.muted = true; sb.play().then(() => { if (sb !== P.act) sb.pause(); sb.muted = false; }).catch(() => { sb.muted = false; }); } }
    P.playing = true; run(); ui();
  }
  function pause(){
    if (!P.act && P.holdT0) P.hold += (performance.now() - P.holdT0) / 1000;
    P.holdT0 = 0; P.playing = false; P.act?.pause(); ui();
  }
  function jump(i){ if (i < 0 || i >= items.length) return; if (!P.act && P.holdT0) P.holdT0 = 0; show(i); }
  P.vids.forEach(v => {
    v.addEventListener("ended", () => { if (v === P.act && P.playing) advance(); });
    v.addEventListener("error", () => { if (v === P.act) { toast(`${items[P.i].s.code}: couldn't load the clip, skipping.`); if (P.playing) setTimeout(advance, 400); } });
    v.addEventListener("timeupdate", () => { if (v === P.act) ui(); });
  });
  // image holds advance on a clock; also keeps the time readout moving
  P.tick = setInterval(() => {
    if (!P.el?.isConnected) return;
    if (P.playing && !P.act && P.holdT0 && elapsedInShot() >= items[P.i].dur - 0.001) advance(); else if (P.playing) ui();
  }, 100);

  const ar = p?.res || p?.frame_size;
  const stage = h("div",{class:"cutstage", "aria-label":"Full cut player"}, ...P.vids, img, blank);
  if (ar) stage.style.aspectRatio = `${ar[0]}/${ar[1]}`;
  P.el = h("section",{class:"viewer cut", "aria-label":"Full cut"},
    h("div",{class:"figbar"}, h("h2",{style:"margin:0;font:600 22px/1.1 var(--display);flex:1"}, `${p?.name || ""} · full cut`),
      h("span",{class:"hint"}, "Each shot's latest version, back to back")),
    h("div",{class:"cuthead"}, codeEl, labEl, h("span",{style:"flex:1"}), countEl),
    stage, prog,
    h("div",{class:"transport"}, prevB, playB, nextB, timeEl),
    h("div",{class:"cutlist", role:"group", "aria-label":"Jump to a shot"}, list),
    h("div",{class:"hint"}, "Boards (images) are held for the shot's length without sound. Pick another version on a shot page with “Use this camera” to change what plays here."));
  show(Math.max(0, items.findIndex(it => it.s.id === keepShot)));
  return [...head, P.el];
}

/* ---------- people ---------- */
async function profilesFor(notes){
  const ids = [...new Set(notes.map(n=>n.author).filter(a => a && a.startsWith("u_")))];
  if (!S.user || !ids.length) return {};
  try { return await S.user.profiles(ids); } catch { return {}; }
}
async function personName(id){
  if (!id) return "Unknown";
  if (!id.startsWith("u_")) return id;
  const ps = S.user ? await S.user.profiles([id]) : {};
  return ps[id]?.name || "Someone";
}

/* ---------- writes ---------- */
function writeFailed(e){
  if (e?.code === "invalid_argument") { S.readOnly = true; toast("You can view this project but not change it."); render(); }
  else if (e?.code === "quota_exceeded") toast("The shot database is full.");
  else toast("Could not save. Check your connection and try again.");
}
// department status. Approved also records who/when (+ which version, from "Approve" on a version) in approvals[k];
// layout keeps the old layout_approved flag in step (Gen ready + the pipeline scripts read it)
async function setStage(row, k, val, kind = "shots", ver = null){
  // send whole maps, so this is right whether update() merges nested maps or replaces them
  const approvals = {...(row.approvals||{})};
  if (val === "approved") approvals[k] = {by:S.me, at:nowIso(), version:ver?.id || approvals[k]?.version || "", label:ver ? versionLabel(ver) : approvals[k]?.label || ""};
  else delete approvals[k];
  const upd = {stages:{...(row.stages||{}), [k]:val}, approvals};
  if (kind === "shots" && k === "layout") upd.layout_approved = val === "approved";
  try { await S.db.doc(`${kind}/${row.id}`).update(upd); toast(`${stageLabel(k)}: ${STATUS_LABEL[val]}`); } catch(e){ writeFailed(e); }
}
async function setShotStatus(s, val){
  try { await S.db.doc("shots/"+s.id).update({status:val || "", status_by:S.me, status_at:nowIso()}); toast(val ? `Shot: ${SHOT_STATUS_LABEL[val]}` : "Shot status cleared"); }
  catch(e){ writeFailed(e); }
}
// shot page: overall status + department chips
function shotStatusBar(s){
  return h("div",{class:"statusbar"},
    h("label",{}, "Shot status",
      h("select",{id:"shot-status", disabled:S.readOnly, onchange:e=>setShotStatus(s, e.target.value)},
        h("option",{value:""},"none"), SHOT_STATUS.map(v => h("option",{value:v, selected:s.status===v}, SHOT_STATUS_LABEL[v])))),
    s.status && s.status_at ? h("span",{class:"muted",style:"font-size:12px"}, `set ${when(s.status_at)}`) : null,
    stageChips(s, true));
}
// under the version tabs: approve the version on screen for its department (its kind), or send it back for a redo
function approveBar(s, cur){
  if (!cur || !projStages().includes(cur.kind) || cur.guide) return null;
  const k = cur.kind, st = stStatus(s.stages?.[k]), ap = s.approvals?.[k];
  const thisOne = st === "approved" && ap?.version === cur.id;
  return h("div",{class:"approvebar"},
    thisOne ? h("span",{class:"ok"}, `✓ ${versionLabel(cur)} approved for ${stageLabel(k)} · ${when(ap.at)}`)
      : st === "approved" ? h("span",{class:"muted",style:"font-size:12px"}, `${stageLabel(k)} approved${ap?.label ? " on " + ap.label : ""}`) : null,
    S.readOnly ? null : [
      thisOne ? null : h("button",{class:"btn primary", onclick:()=>setStage(s, k, "approved", "shots", cur)}, `Approve for ${stageLabel(k)}`),
      st === "redo" ? null : h("button",{class:"btn", onclick:()=>setStage(s, k, "redo", "shots", cur)}, "Needs redo")]);
}
async function setNoteStatus(n, status){
  try { await S.db.doc("notes/"+n.id).update(status==="done" ? {status, done_by:S.me, done_at:new Date().toISOString()} : {status, done_by:null, done_at:null}); toast(status==="done"?"Marked done":"Reopened"); }
  catch(e){ writeFailed(e); }
}

/* ---------- routing + render ---------- */
function go(view, shotId){
  S.view = view; if (shotId) { S.shotId = shotId; S.versionId = null; S.versionPicked = false; }
  render(); window.scrollTo({top:0});
}
let renderSeq = 0;
async function render(){
  const seq = ++renderSeq;
  if (S.view !== "cut") stopCut();   // a detached player would keep playing sound
  renderHeader();
  let kids;
  if (!S.db) kids = [h("div",{class:"empty"},h("strong",{},"The demo data did not load"),h("span",{},"Reload the page to try again."))];
  else if (S.view === "shot") kids = await renderShot();
  else if (S.view === "notes") kids = await renderOpenNotes();
  else if (S.view === "animatic") kids = renderAnimatic();
  else if (S.view === "cut") kids = renderCut();
  else if (S.view === "assets") kids = renderAssets();
  else if (S.view === "script") kids = renderScript();
  else if (S.view === "genready") kids = renderGenReady();
  else if (S.view === "newproject") kids = renderNewProject();
  else kids = renderGrid();
  if (seq !== renderSeq) return;
  // keep the note draft focus when live updates re-render the shot page
  const active = document.activeElement?.id; const caret = document.activeElement?.selectionStart;
  app.replaceChildren(...kids.flat().filter(Boolean));
  if (active && $(active)) { $(active).focus(); try{ if (caret!=null) $(active).setSelectionRange(caret,caret); }catch{} }
}

function subscribeProject(pid){
  S.unsub.forEach(u=>u()); S.unsub = [];
  S.shots = []; S.versions = []; S.notes = []; S.assetRows = []; S.loaded.shots = false; S.loaded.assets = false; S.loaded.versions = false;
  const err = e => { if (e?.code === "revoked") { S.db = null; render(); } };
  const snap = (key, after) => qs => { S[key] = qs.docs.map(d => ({id:d.id, ...d.data()})); if (after) after(); render(); };
  S.unsub.push(S.db.collection("shots").where("project","==",pid).onSnapshot(snap("shots",()=>S.loaded.shots=true), err));
  S.unsub.push(S.db.collection("versions").where("project","==",pid).onSnapshot(snap("versions",()=>S.loaded.versions=true), err));
  S.unsub.push(S.db.collection("notes").where("project","==",pid).onSnapshot(snap("notes"), err));
  S.unsub.push(S.db.collection("assets").where("project","==",pid).onSnapshot(snap("assetRows",()=>S.loaded.assets=true), err));
}

$("tab-grid").addEventListener("click",()=>go("grid"));
$("tab-notes").addEventListener("click",()=>go("notes"));
$("tab-assets").addEventListener("click",()=>go("assets"));
$("tab-script").addEventListener("click",()=>go("script"));
$("tab-genready").addEventListener("click",()=>go("genready"));
$("newproj").addEventListener("click",()=>go("newproject"));
$("project").addEventListener("change", e => { S.pid = e.target.value; store.set("sg-project", S.pid); S.view = S.view==="assets" ? "assets" : "grid"; subscribeProject(S.pid); render(); });

async function start(){
  try { S.user = await ReelRoomDemo.use("user"); } catch { S.user = null; }
  try { S.db = await ReelRoomDemo.use("db"); } catch { S.db = null; }
  try { S.assets = await ReelRoomDemo.use("assets"); } catch { S.assets = null; }
  if (S.user){ S.me = await S.user.id(); S.canWrite = await S.user.can("data.write"); if (S.canWrite === false) S.readOnly = true; }
  if (!S.db) { render(); return; }
  S.db.collection("projects").onSnapshot(qs => {
    S.projects = qs.docs.map(d=>({id:d.id, ...d.data()})).sort((a,b)=>(a.sort??0)-(b.sort??0));
    S.loaded.projects = true;
    // a just-created project wins once its doc arrives
    if (S.pendingPid && S.projects.some(p=>p.id===S.pendingPid)) { store.set("sg-project", S.pendingPid); S.pid = null; }
    const want = S.pendingPid || S.pid || store.get("sg-project");
    const pick = S.projects.find(p=>p.id===want)?.id || S.pid || S.projects[0]?.id || null;
    if (pick === S.pendingPid) S.pendingPid = null;
    if (pick !== S.pid){ S.pid = pick; if (pick) subscribeProject(pick); }
    const hash = location.hash.slice(1);
    // #SH010 opens the shot on its latest output; #SH010/playblast_fix_v001 opens that version
    if (hash && S.view==="grid" && !S.shotId) {
      const [code, ver] = decodeURIComponent(hash).split("/");
      S.shotId = `${S.pid}__${code}`; S.view = "shot";
      if (ver) { S.versionId = `${S.shotId}__${ver}`; S.versionPicked = true; }
    }
    if (!S.projects.length) S.loaded.shots = true;
    render();
  }, () => render());
  render();
}
(function boot(tries){
  if (window.ReelRoomDemo?.use) start();
  else if (tries < 30) setTimeout(()=>boot(tries+1), 100);
  else { S.db = null; render(); }
})(0);
})();
