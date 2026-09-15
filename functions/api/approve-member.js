// POST /api/approve-member { requestId, approve: true|false } (admin)  (P2-8)
// Approve: creates the employee with the hashed PIN the requester chose, marks
// the request approved (approvedBy = session name), tells the LINE group when
// one is connected. Reject: marks it rejected. The credential hash is dropped
// from the request either way. Returns the fresh (credential-free) employees +
// adminRequests arrays and their versions so the client adopts them as saved.
import { requireAdmin, readJson, stripEmployee, stripRequest } from "../_lib/auth.js";
import { readField, writeField } from "../_lib/store.js";
import { appendAudit } from "../_lib/audit.js";
import { notifyGroup } from "../_lib/line.js";

export async function onRequestPost(context) {
  const auth = await requireAdmin(context);
  if (!auth.ok) return auth.response;
  const { env, request } = context;
  const body = await readJson(request);
  const requestId = String(body.requestId || "");
  const approve = body.approve !== false;
  if (!requestId) return Response.json({ ok: false, error: "requestId required" }, { status: 400 });

  const { value: reqs } = await readField(env.KV, "adminRequests");
  const list = Array.isArray(reqs) ? reqs : [];
  const idx = list.findIndex(r => r && r.id === requestId && r.type === "member-register");
  if (idx < 0) return Response.json({ ok: false, error: "unknown request" }, { status: 404 });
  const req = list[idx];
  if (req.status !== "pending") return Response.json({ ok: false, error: "already " + req.status }, { status: 409 });

  const by = auth.session.name || "Admin";
  const resolvedAt = new Date().toISOString();
  let employee = null;
  let vEmployees = null;
  if (approve) {
    const { value: emps } = await readField(env.KV, "employees");
    const employees = Array.isArray(emps) ? emps : [];
    employee = { id: "e" + Date.now(), name: String(req.name || "").trim(), ...(req.contact ? { contact: req.contact } : {}), ...(req.requestedPinHash ? { pinHash: req.requestedPinHash } : {}), approvedBy: by, approvedAt: resolvedAt };
    vEmployees = await writeField(env.KV, "employees", [...employees, employee]);
  }
  const { requestedPin, requestedPinHash, ...rest } = req;
  const updated = { ...rest, status: approve ? "approved" : "rejected", resolvedAt, approvedBy: by, ...(employee ? { employeeId: employee.id } : {}) };
  const next = list.map((r, i) => (i === idx ? updated : r));
  const vRequests = await writeField(env.KV, "adminRequests", next);
  await appendAudit(env.KV, auth.session, { action: approve ? "member.approve" : "member.reject", recordId: requestId, name: updated.name, targetId: employee ? employee.id : undefined });

  const { value: groupId } = await readField(env.KV, "lineGroupId");
  if (groupId) {
    await notifyGroup(env, groupId, approve
      ? `✅ ${updated.name} approved as crew / อนุมัติเข้าทีมแล้ว (${by})\nLog in with the PIN you chose / เข้าระบบด้วย PIN ที่ตั้งไว้: https://pickshootreturn.pages.dev`
      : `❌ ${updated.name}: crew request declined / คำขอเข้าทีมไม่ผ่าน (${by})`);
  }
  const { value: allEmps } = await readField(env.KV, "employees");
  return Response.json({
    ok: true,
    employee: employee ? stripEmployee(employee) : null,
    request: stripRequest(updated),
    employees: (Array.isArray(allEmps) ? allEmps : []).map(stripEmployee),
    adminRequests: next.map(stripRequest),
    _v: { adminRequests: vRequests, ...(vEmployees ? { employees: vEmployees } : {}) },
  });
}
