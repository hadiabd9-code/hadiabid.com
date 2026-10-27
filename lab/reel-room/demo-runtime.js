/* Reel Room public demo: an in-memory stand-in for the private tool's database, user and upload services.
   Seeded from data.json (a sanitized Halden 418 snapshot). Every write lives in this tab only and is gone on reload:
   nothing is sent anywhere and nothing is saved to the browser. */
(() => {
  "use strict";
  const clone = o => o == null ? o : JSON.parse(JSON.stringify(o));
  const tables = {};            // collection -> Map(id -> doc)
  const listeners = new Set();  // {coll, where, cb}
  const blobs = new Map();      // upload id -> Blob (drawings attached to notes)
  let seq = 0;

  const ready = fetch("data.json", {cache: "no-cache"})
    .then(r => { if (!r.ok) throw new Error("data.json " + r.status); return r.json(); })
    .then(d => { for (const [c, docs] of Object.entries(d.collections || {})) tables[c] = new Map(Object.entries(docs)); });

  const table = c => tables[c] || (tables[c] = new Map());
  const match = (doc, where) => !where || (where[1] === "==" && doc[where[0]] === where[2]);
  function snapshot(coll, where){
    const docs = [...table(coll)].filter(([, d]) => match(d, where)).map(([id, d]) => ({id, data: () => clone(d)}));
    return {docs, size: docs.length, empty: !docs.length};
  }
  function notify(coll){
    for (const l of listeners) if (l.coll === coll) queueMicrotask(() => { if (listeners.has(l)) l.cb(snapshot(coll, l.where)); });
  }
  function query(coll, where){
    return {
      where: (field, op, value) => query(coll, [field, op, value]),
      onSnapshot(cb, onErr){
        const l = {coll, where, cb};
        listeners.add(l);
        ready.then(() => { if (listeners.has(l)) cb(snapshot(coll, where)); }, e => { if (onErr) onErr(e); });
        return () => listeners.delete(l);
      },
      async add(data){
        await ready;
        const id = "demo_" + Date.now().toString(36) + "_" + (++seq);
        table(coll).set(id, clone(data)); notify(coll);
        return {id};
      }
    };
  }
  function doc(path){
    const i = path.indexOf("/"), coll = path.slice(0, i), id = path.slice(i + 1);
    return {
      id,
      async get(){ await ready; const d = table(coll).get(id); return {id, exists: !!d, data: () => clone(d)}; },
      async set(data){ await ready; table(coll).set(id, clone(data)); notify(coll); },
      // top-level merge, like the real database (the page always sends whole nested maps)
      async update(data){
        await ready;
        const cur = table(coll).get(id);
        if (!cur) { const e = new Error("not found"); e.code = "not_found"; throw e; }
        table(coll).set(id, {...cur, ...clone(data)}); notify(coll);
      }
    };
  }

  const db = {collection: name => query(name), doc};
  const user = {
    id: async () => "You (demo)",
    can: async () => true,          // edits are allowed, they just stay in memory
    profiles: async () => ({})      // demo authors are plain role names, no profiles to look up
  };
  const assets = {
    async upload(file){
      const id = "demo-blob:" + (++seq);
      blobs.set(id, file);
      return {id};
    }
  };

  window.ReelRoomDemo = {
    use: async cap => ({db, user, assets})[cap] || null,
    blob: id => blobs.get(id) || null,
    ready
  };
})();
