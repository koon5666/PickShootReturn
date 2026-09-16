// Department role list for crew positions (P3-4). Replaces the Steadicam-only
// fallback. Thai labels are the names crews actually use on set (mostly the
// English term in Thai script, the way call sheets print them).
export const DEPARTMENTS = [
  { id: "camera", en: "Camera", th: "กล้อง", roles: [
    { en: "Director of Photography", th: "ผู้กำกับภาพ (DP)" },
    { en: "Camera Operator", th: "ตากล้อง" },
    { en: "1st AC", th: "ผู้ช่วยกล้อง 1 (โฟกัส)" },
    { en: "2nd AC", th: "ผู้ช่วยกล้อง 2" },
    { en: "DIT", th: "DIT" },
    { en: "Steadicam Operator", th: "สเตดิแคม" },
    { en: "1st Steadicam Assistant", th: "ผู้ช่วยสเตดิแคม 1" },
    { en: "Remote Head Tech", th: "ช่างรีโมทเฮด" },
    { en: "Drone Operator", th: "นักบินโดรน" },
  ] },
  { id: "lighting", en: "Lighting", th: "ไฟ", roles: [
    { en: "Gaffer", th: "หัวหน้าไฟ (Gaffer)" },
    { en: "Best Boy Electric", th: "ผู้ช่วยหัวหน้าไฟ" },
    { en: "Lighting Technician", th: "ช่างไฟ" },
  ] },
  { id: "grip", en: "Grip", th: "กริ๊ป", roles: [
    { en: "Key Grip", th: "หัวหน้ากริ๊ป" },
    { en: "Best Boy Grip", th: "ผู้ช่วยหัวหน้ากริ๊ป" },
    { en: "Grip", th: "กริ๊ป" },
    { en: "Dolly Grip", th: "ดอลลี่กริ๊ป" },
  ] },
  { id: "sound", en: "Sound", th: "เสียง", roles: [
    { en: "Sound Recordist", th: "ซาวด์ (บันทึกเสียง)" },
    { en: "Boom Operator", th: "บูม" },
  ] },
  { id: "production", en: "Production", th: "โปรดักชัน", roles: [
    { en: "Producer", th: "โปรดิวเซอร์" },
    { en: "Line Producer", th: "ไลน์โปรดิวเซอร์" },
    { en: "Production Manager", th: "ผู้จัดการกองถ่าย" },
    { en: "Production Assistant", th: "ผู้ช่วยกองถ่าย (PA)" },
    { en: "1st AD", th: "ผู้ช่วยผู้กำกับ 1" },
    { en: "2nd AD", th: "ผู้ช่วยผู้กำกับ 2" },
  ] },
  { id: "art", en: "Art", th: "อาร์ต", roles: [
    { en: "Production Designer", th: "ผู้กำกับศิลป์" },
    { en: "Art Director", th: "อาร์ตไดเรกเตอร์" },
    { en: "Props Master", th: "พร็อพ" },
    { en: "Stylist", th: "สไตลิสต์" },
    { en: "Make-up Artist", th: "แต่งหน้า" },
  ] },
];

// Flat list of role names for a select / datalist. `lang` picks the label;
// the stored value is always the English name so invoices stay consistent.
//
// `custom` (KV field `roleList`, admin-managed, P3-4 F18) REPLACES the built-in
// department list when it holds anything: a house that hires only its own set of
// roles sees exactly that list everywhere (crew profile, admin positions, job
// roster, invoice position picker). One entry per line in Settings, optionally
// "Role Name | Department"; a Thai label can follow the English name after a
// slash ("Gaffer / หัวหน้าไฟ | Lighting").
export function parseRoleList(list) {
  const rows = Array.isArray(list) ? list : String(list || "").split("\n");
  const out = [];
  for (const row of rows) {
    const line = String(row == null ? "" : row).trim();
    if (!line) continue;
    const [namePart, deptPart] = line.split("|").map(x => (x || "").trim());
    const [en, th] = namePart.split("/").map(x => (x || "").trim());
    if (!en) continue;
    out.push({ en, th: th || en, dept: deptPart || "" });
  }
  return out;
}
export function roleOptions(lang = "en", custom = null) {
  const rows = parseRoleList(custom);
  if (rows.length) return rows.map(r => ({ value: r.en, label: lang === "th" ? r.th : r.en, dept: r.dept, deptId: "house", custom: true }));
  const out = [];
  for (const d of DEPARTMENTS) {
    for (const r of d.roles) out.push({ value: r.en, label: lang === "th" ? r.th : r.en, dept: lang === "th" ? d.th : d.en, deptId: d.id });
  }
  return out;
}
// Text the Settings editor shows for the saved list (round-trips through parseRoleList).
export const roleListText = (list) => parseRoleList(list).map(r => `${r.en}${r.th && r.th !== r.en ? ` / ${r.th}` : ""}${r.dept ? ` | ${r.dept}` : ""}`).join("\n");

export const DEFAULT_POSITION_NAMES = roleOptions("en").map(r => r.value);
