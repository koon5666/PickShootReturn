// Lazy per-entry photo fetch. The boot payload (/api/data) strips base64 photos
// from checkouts + resolved admin requests; this returns them on demand for the
// few surfaces that render them (equipment History modal, Approvals resolved/all
// tab). Scoped to those two fields so it is NOT an arbitrary KV-read primitive.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const ALLOWED = new Set(["checkouts", "adminRequests"]);

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet({ env, request }) {
  const url = new URL(request.url);
  const field = url.searchParams.get("field");
  if (!ALLOWED.has(field)) {
    return Response.json({ error: "bad field" }, { status: 400, headers: CORS });
  }
  const idsParam = url.searchParams.get("ids") || url.searchParams.get("id") || "";
  const want = new Set(idsParam.split(",").map(s => s.trim()).filter(Boolean));
  if (!want.size) return Response.json({ photos: {} }, { headers: CORS });

  const arr = (await env.KV.get(field, "json")) || [];
  const photos = {};
  for (const e of arr) {
    if (e && want.has(e.id) && typeof e.photo === "string" && e.photo.startsWith("data:")) {
      photos[e.id] = e.photo;
    }
  }
  return Response.json({ photos }, {
    headers: { ...CORS, "Cache-Control": "public, max-age=86400" },
  });
}
