// Hardening track (security re-review of fix/review-2026-09): copy for the
// crew new-record cap on PUT /api/data and the lazy-loaded view chunks (P3-8).
export default {
  en: {
    syncTooMany: "Save refused: \"{field}\" would add {n} new records at once (limit {limit}). Nothing was saved. Reload the page and try again.",
    viewLoadFailed: "This part of the app could not load. Check the connection and reload the page.",
  },
  th: {
    syncTooMany: "บันทึกไม่ได้: \"{field}\" จะเพิ่มรายการใหม่ทีเดียว {n} รายการ (จำกัด {limit}) ยังไม่มีอะไรถูกบันทึก รีโหลดหน้าแล้วลองใหม่",
    viewLoadFailed: "โหลดส่วนนี้ของแอปไม่ได้ เช็กสัญญาณเน็ตแล้วรีโหลดหน้า",
  },
};
