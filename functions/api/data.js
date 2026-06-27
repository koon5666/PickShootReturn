const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestGet({ env }) {
  const [equipment, jobs, checkouts, employees, reports, productionCompanies, invoices, companyName, equipmentRequests, adminPin] = await Promise.all([
    env.KV.get("equipment", "json"),
    env.KV.get("jobs", "json"),
    env.KV.get("checkouts", "json"),
    env.KV.get("employees", "json"),
    env.KV.get("reports", "json"),
    env.KV.get("productionCompanies", "json"),
    env.KV.get("invoices", "json"),
    env.KV.get("companyName", "json"),
    env.KV.get("equipmentRequests", "json"),
    env.KV.get("adminPin", "json"),
  ]);
  return Response.json({ equipment, jobs, checkouts, employees, reports, productionCompanies, invoices, companyName, equipmentRequests, adminPin }, { headers: CORS });
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
  if (body.employees !== undefined)
    ops.push(env.KV.put("employees", JSON.stringify(body.employees)));
  if (body.reports !== undefined)
    ops.push(env.KV.put("reports", JSON.stringify(body.reports)));
  if (body.productionCompanies !== undefined)
    ops.push(env.KV.put("productionCompanies", JSON.stringify(body.productionCompanies)));
  if (body.invoices !== undefined)
    ops.push(env.KV.put("invoices", JSON.stringify(body.invoices)));
  if (body.companyName !== undefined)
    ops.push(env.KV.put("companyName", JSON.stringify(body.companyName)));
  if (body.equipmentRequests !== undefined)
    ops.push(env.KV.put("equipmentRequests", JSON.stringify(body.equipmentRequests)));
  if (body.adminPin !== undefined)
    ops.push(env.KV.put("adminPin", JSON.stringify(body.adminPin)));
  await Promise.all(ops);
  return Response.json({ ok: true }, { headers: CORS });
}
