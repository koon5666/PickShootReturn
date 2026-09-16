// Who hears about a request outcome, and what they read. Shared by the
// dashboard gear-request card (src/views/admin.jsx) and the early pickup /
// early return approvals (src/App.jsx), so the rule and the wording are unit
// tested (requestPush.test.js) instead of living inline in two views.
//
//   group      the connected LINE group. The crew member's request was posted
//              there when it went in, so the group hears the APPROVAL too.
//              A denial stays between the house and the requester.
//   requester  the crew member's own LINE when linked. The server resolves
//              the LINE id from the employee id (P3-6: clients only ever see
//              `lineLinked`), so the client names the employee, not the id.
//
// Returns { userIds, employeeIds } for api.notify, or null when nobody can be
// reached (muted, no group, requester not linked) so the caller sends nothing.
export function outcomeRecipients({ ok, lineGroupId, lineNotifyMuted, employees, employeeId }) {
  if (lineNotifyMuted) return null;
  const userIds = ok && lineGroupId ? [lineGroupId] : [];
  const linked = !!employeeId && (employees || []).some(e => e && e.id === employeeId && e.lineLinked);
  const employeeIds = linked ? [employeeId] : [];
  if (!userIds.length && !employeeIds.length) return null;
  return { userIds, employeeIds };
}

export const APP_LINK = "https://pickshootreturn.pages.dev";

const outcomeLine = (ok, label, who) => `${ok ? "✅" : "❌"} [${label}] ${who || ""}`.trimEnd();

// Gear request outcome. Mirrors the crew's own "[Gear Request]" post so the
// group can match the two: who, the items (×qty), the dates, the job or
// practice line, the app link.
export function gearOutcomeMessage(req, ok, { t, formatDate }) {
  const items = (req.items && req.items.length ? req.items : [{ eqName: req.eqName, qty: req.qty }])
    .map(it => `${it.eqName || ""}${(+it.qty || 1) > 1 ? ` ×${it.qty}` : ""}`).join(", ");
  const dates = (req.useDates || []).map(d => formatDate(d)).join(", ");
  const work = req.purpose === "work" || (!req.purpose && req.jobName);
  const purpose = work
    ? `${t("reqWork")}${req.jobName || ""}${req.productionName ? ` (${req.productionName})` : ""}`
    : req.purpose === "practice" ? t("reqPractice") : "";
  return [
    outcomeLine(ok, t(ok ? "notifyGearApproved" : "notifyGearDenied"), req.employeeName),
    `🎥 ${items}`,
    dates ? `📅 ${dates}` : "",
    purpose ? `💼 ${purpose}` : "",
    `🔗 ${APP_LINK}`,
  ].filter(Boolean).join("\n");
}

// Early pickup / early return outcome: who, the job, the day asked for, the link.
export function earlyOutcomeMessage(req, ok, { t, formatDate }) {
  const pickup = req.type === "early-pickup";
  const label = t(pickup
    ? (ok ? "notifyEarlyPickupApproved" : "notifyEarlyPickupRejected")
    : (ok ? "notifyEarlyReturnApproved" : "notifyEarlyReturnRejected"));
  return [
    outcomeLine(ok, label, req.employeeName),
    req.jobName ? `🎬 ${req.jobName}` : "",
    req.requestedDate ? `📅 ${formatDate(req.requestedDate)}` : "",
    `🔗 ${APP_LINK}`,
  ].filter(Boolean).join("\n");
}
