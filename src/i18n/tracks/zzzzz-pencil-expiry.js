// Track: pencil expiry (2026-10-20). A Pencil whose last shoot day has passed
// becomes Declined by itself (src/logic/pencilExpiry.js); the Declined tab tags it.
export default {
  en: {
    jobAutoDeclined: "Auto: pencil expired",
    jobAutoDeclinedHint: "This pencil was never confirmed and its last shoot day has passed, so the system declined it. Edit the job to confirm it or move its dates.",
  },
  th: {
    jobAutoDeclined: "ระบบปฏิเสธให้ เพนซิลเลยวัน",
    jobAutoDeclinedHint: "เพนซิลนี้ไม่ได้คอนเฟิร์ม และเลยวันถ่ายวันสุดท้ายแล้ว ระบบเลยเปลี่ยนเป็นปฏิเสธให้ ถ้างานเกิดขึ้นจริง กดแก้งานแล้วเปลี่ยนเป็นยืนยัน หรือย้ายวันได้",
  },
};
