// Server-side array merge rules used by PUT /api/data (functions/api/data.js).
// Pure functions, no KV access: unit-tested in merge.test.js. Behaviour is
// byte-identical to the inline code that used to live in data.js.
//
// Files under functions/_lib are shared helpers, not routes (Pages Functions
// only routes files that do not start with an underscore).

export const isDataUri = (s) => typeof s === "string" && s.startsWith("data:");

// Lean boot: strip an inline base64 photo to `null` + a `hasPhoto` marker.
export function stripPhoto(entry) {
  if (entry && isDataUri(entry.photo)) {
    const { photo, ...rest } = entry;
    return { ...rest, photo: null, hasPhoto: true };
  }
  return entry;
}

// Merge an incoming photo-bearing array (checkouts, adminRequests) against KV,
// preserving each entry's photo when the incoming copy is absent/stripped
// (loaded lean). A real data: URI in the incoming entry always wins (new
// capture / re-shot photo). KV-only entries (added by another session, not in
// this payload) are kept. The transient `hasPhoto` marker is never persisted.
export function mergePhotoArray(incoming, existing) {
  const exMap = new Map((existing || []).map(e => [e.id, e]));
  const incomingIds = new Set(incoming.map(e => e.id));
  const merged = incoming.map(inc => {
    const kv = exMap.get(inc.id);
    const photo = isDataUri(inc.photo) ? inc.photo : ((kv && kv.photo) ?? inc.photo ?? null);
    const { hasPhoto, ...rest } = inc; // never persist the transient lean marker
    return { ...rest, photo };
  });
  // keep KV-only entries (added by another session, not in this payload)
  for (const e of (existing || [])) if (!incomingIds.has(e.id)) merged.push(e);
  return merged;
}

// Id-merge for arrays where concurrent sessions append independently
// (equipmentRequests): incoming entries win for shared ids, KV-only ids are
// preserved so a stale session never erases another session's additions.
export function mergeById(incoming, existing) {
  const incomingIds = new Set(incoming.map(e => e.id));
  return [...incoming, ...(existing || []).filter(e => !incomingIds.has(e.id))];
}
