// POST /api/approve-member { requestId, approve: true|false } (admin)  (P2-8)
// Approve: creates the employee with the hashed PIN the requester chose, marks
// the request approved (approvedBy = session name), emails the applicant when
// their contact is an email address. Reject: marks it rejected (and emails too). The credential hash is dropped
// from the request either way. Returns the fresh (credential-free) employees +
// adminRequests arrays and their versions so the client adopts them as saved.
import { requireAdmin, readJson, stripEmployee, stripRequest } from "../_lib/auth.js";
import { readField, writeField } from "../_lib/store.js";
import { appendAudit } from "../_lib/audit.js";
import { normalizeMessage, deliver, cleanEmail, emailKey } from "../_lib/email.js";

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

  // The applicant hears the outcome by email when the contact they gave is an
  // address (2026-10-01: LINE carries only the 08:00 summary). An approved
  // member's email is indexed at once so job emails reach them before they
  // ever open their profile.
  const applicant = cleanEmail(req.contact);
  if (applicant) {
    if (employee) await env.KV.put(emailKey(employee.id), applicant);
    const appUrl = new URL(request.url).origin;
    const msg = normalizeMessage(approve ? {
      subject: "You're in: Pick Shoot Return crew",
      heading: "Your crew request was approved / อนุมัติเข้าทีมแล้ว",
      intro: `Hi ${updated.name}, you can log in now with the name and PIN you chose.\nเข้าระบบได้เลยด้วยชื่อและ PIN ที่ตั้งไว้`,
      tone: "good",
      sections: [{ title: "Details", rows: [["Name / ชื่อ", updated.name], ["Approved by / อนุมัติโดย", by]] }],
      link: { url: "/", label: "Log in to Pick Shoot Return" },
    } : {
      subject: "Your Pick Shoot Return crew request",
      heading: "Your crew request was declined / คำขอเข้าทีมไม่ผ่าน",
      intro: `Hi ${updated.name}, the house declined this request. Contact them directly if you think this is a mistake.\nร้านปฏิเสธคำขอนี้ หากคิดว่าผิดพลาด กรุณาติดต่อร้านโดยตรง`,
      tone: "bad",
      sections: [{ title: "Details", rows: [["Name / ชื่อ", updated.name], ["Declined by / โดย", by]] }],
      link: { url: "/", label: "Open Pick Shoot Return" },
    }, { appUrl });
    const { value: adminEmail } = await readField(env.KV, "adminEmail");
    await deliver(env, msg, [{ email: applicant, id: employee ? employee.id : "applicant" }], { replyTo: cleanEmail(adminEmail) }).catch(() => null);
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
