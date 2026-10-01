// Superseded 2026-10-01 by the 08:00 daily summary (functions/api/daily-summary.js),
// which folds overdue gear into the one LINE group post and emails the crew who
// hold it. Kept as an alias so a presence worker still calling the old path
// (09:00 cron) keeps working until it is redeployed.
export { onRequestGet, onRequestPost } from "./daily-summary.js";
