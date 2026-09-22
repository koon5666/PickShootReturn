// 2026-09-22: the P2-9 owner lock on a production house was lifted. Crew no
// longer have to ask an admin to correct a billing address on their own
// invoice, so the read-only wording is replaced by a shared-list heads-up.
export default {
  en: {
    prodHouseSharedEdit: "Added by {name}. The whole team shares this production house, so your change shows on their documents too.",
    prodHouseHint: "Tap a production house to edit its billing details. Anyone can correct a wrong address; the team shares one list.",
    editedByTag: "{name} edited",
  },
  th: {
    prodHouseSharedEdit: "เพิ่มโดย {name} บริษัทนี้ทั้งทีมใช้ร่วมกัน แก้แล้วจะมีผลกับเอกสารของคนอื่นด้วย",
    prodHouseHint: "แตะบริษัทผลิตเพื่อแก้ข้อมูลออกบิล ใครก็แก้ที่อยู่ที่ผิดได้ เพราะทั้งทีมใช้รายการเดียวกัน",
    editedByTag: "{name} แก้ไข",
  },
};
