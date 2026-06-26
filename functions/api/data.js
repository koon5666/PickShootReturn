const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet({ env }) {
  const [equipment, jobs, checkouts] = await Promise.all([
    env.KV.get("equipment", "json"),
    env.KV.get("jobs", "json"),
    env.KV.get("checkouts", "json"),
  ]);
  return Response.json({ equipment, jobs, checkouts }, { headers: CORS });
}

export async function onRequestPut({ request, env }) {
  const body = await request.json();
  const ops = [];
  if (body.equipment !== undefined)
    ops.push(env.KV.put("equipment", JSON.stringify(body.equipment)));
  if (body.jobs !== undefined)
    ops.push(env.KV.put("jobs", JSON.stringify(body.jobs)));
  if (body.checkouts !== undefined)
    ops.push(env.KV.put("checkouts", JSON.stringify(body.checkouts)));
  await Promise.all(ops);
  return Response.json({ ok: true }, { headers: CORS });
}
