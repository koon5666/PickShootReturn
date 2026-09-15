// Lazy per-entry photo fetch. The boot payload (/api/data) strips base64 photos
// from checkouts + resolved admin requests; this returns them on demand for the
// few surfaces that render them (equipment History modal, Approvals resolved/all
// tab). Photos live in their own keys (photo:<field>:<id>, functions/_lib/photos.js);
// an unmigrated record still carrying the photo inline is served from the array
// as a fallback. Scoped to two fields so it is NOT an arbitrary KV-read primitive.
import { readField } from "../_lib/store.js";
import { photoKey, isDataUri } from "../_lib/photos.js";
import { requireSession } from "../_lib/auth.js";

const CORS = {};

const ALLOWED = new Set(["checkouts", "adminRequests"]);

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet(context) {
  const auth = await requireSession(context);
  if (!auth.ok) return auth.response;
  const { env, request } = context;
  const url = new URL(request.url);
  const field = url.searchParams.get("field");
  if (!ALLOWED.has(field)) {
    return Response.json({ error: "bad field" }, { status: 400, headers: CORS });
  }
  const idsParam = url.searchParams.get("ids") || url.searchParams.get("id") || "";
  const want = [...new Set(idsParam.split(",").map(s => s.trim()).filter(Boolean))].slice(0, 50);
  if (!want.length) return Response.json({ photos: {} }, { headers: CORS });

  const photos = {};
  // Own keys first (one read per id, parallel).
  const own = await Promise.all(want.map(id => env.KV.get(photoKey(field, id))));
  const missing = [];
  want.forEach((id, i) => { if (isDataUri(own[i])) photos[id] = own[i]; else missing.push(id); });
  // Fallback for records not migrated yet: read the array once.
  if (missing.length) {
    const { value } = await readField(env.KV, field);
    if (Array.isArray(value)) {
      const miss = new Set(missing);
      for (const e of value) if (e && miss.has(e.id) && isDataUri(e.photo)) photos[e.id] = e.photo;
    }
  }
  return Response.json({ photos }, {
    headers: { ...CORS, "Cache-Control": "private, max-age=86400" },
  });
}
