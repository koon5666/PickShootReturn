// In-memory stand-in for a Cloudflare KV namespace binding, for unit tests of
// functions/_lib/* (get / put / delete / list / getWithMetadata, with the same
// string-only value semantics and prefix/cursor listing as the real thing).
export function fakeKV(initial = {}) {
  const store = new Map();
  const meta = new Map();
  for (const [k, v] of Object.entries(initial)) store.set(k, typeof v === "string" ? v : JSON.stringify(v));
  const api = {
    writes: 0, reads: 0,
    async get(key, type) {
      api.reads++;
      const v = store.has(key) ? store.get(key) : null;
      if (v === null) return null;
      if (type === "json") { try { return JSON.parse(v); } catch { return null; } }
      return v;
    },
    async getWithMetadata(key, type) {
      const value = await api.get(key, type);
      return { value, metadata: meta.get(key) ?? null };
    },
    async put(key, value, opts) {
      api.writes++;
      if (typeof value !== "string") throw new Error("fakeKV: put value must be a string");
      store.set(key, value);
      if (opts && opts.metadata !== undefined) meta.set(key, opts.metadata); else meta.delete(key);
    },
    async delete(key) { store.delete(key); meta.delete(key); },
    async list({ prefix = "", cursor, limit = 1000 } = {}) {
      const all = [...store.keys()].filter(k => k.startsWith(prefix)).sort();
      const start = cursor ? parseInt(cursor, 10) : 0;
      const keys = all.slice(start, start + limit).map(name => ({ name, metadata: meta.get(name) ?? null }));
      const done = start + limit >= all.length;
      return { keys, list_complete: done, cursor: done ? undefined : String(start + limit) };
    },
    // test helpers
    keys() { return [...store.keys()].sort(); },
    raw(key) { return store.get(key) ?? null; },
    json(key) { const v = store.get(key); return v == null ? null : JSON.parse(v); },
    metaOf(key) { return meta.get(key) ?? null; },
    size(key) { return (store.get(key) || "").length; },
  };
  return api;
}
