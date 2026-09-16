// Calendar + job detail modal (P3-8 code split), shared by the admin dashboard
// and the crew view, so it is its own small chunk.
import { useState } from "react";
import { formatDate } from "../i18n/format.js";
import { JOB_STATUS_BADGE, j, Icon, icons, today, S, Modal } from "../ui/shared.jsx";

// ─── JOB DETAIL MODAL ────────────────────────────────────────────────────────
export function JobDetailModal({ job, equipment, onClose, onEdit }) {
  if (!job) return null;
  const statusColor = JOB_STATUS_BADGE;
  return (
    <Modal title="Job Details" onClose={onClose}>
      <div style={S.col}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <span style={S.badge(statusColor[job.status] || "gray")}>{job.status}</span>
          <span style={S.badge("blue")}>{job.location}{job.locationCity ? ` · ${job.locationCity}` : ""}</span>
          <span style={S.badge("gray")}>{job.shootTime}</span>
        </div>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "var(--text,#16324A)" }}>{job.name}</h2>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--text-muted,#4E6B84)" }}>{job.production}</p>
        </div>
        <div style={S.divider} />
        <div>
          <p style={S.label}>Shoot Dates</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {job.dates.map(d => (
              <span key={d} style={{ ...S.badge(d === today() ? "amber" : d < today() ? "gray" : "blue") }}>
                {formatDate(d)}{d === today() ? " ★" : ""}
              </span>
            ))}
          </div>
          {(job.pickupDate || job.returnDate) && (
            <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--text-muted,#4E6B84)" }}>
              {job.pickupDate ? <><Icon d={icons.package} size={12} style={{ verticalAlign: "-2px", marginRight: 3 }} />Pickup from <strong style={{ color: "var(--text,#16324A)" }}>{formatDate(job.pickupDate)}</strong></> : null}
              {job.pickupDate && job.returnDate ? " · " : ""}
              {job.returnDate ? <><Icon d={icons.undo} size={12} style={{ verticalAlign: "-2px", marginRight: 3 }} />Return by <strong style={{ color: "var(--text,#16324A)" }}>{formatDate(job.returnDate)}</strong></> : null}
            </p>
          )}
        </div>
        {(job.assignedEquipment || []).length > 0 && (
          <div>
            <p style={S.label}>Assigned Equipment</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {job.assignedEquipment.map(ae => {
                const eq = equipment.find(e => e.id === ae.eqId);
                if (!eq) return null;
                return (
                  <div key={ae.eqId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: "var(--surface2,#EAF0F7)", borderRadius: 8 }}>
                    {eq.photo && <img src={eq.photo} alt="" style={{ width: 36, height: 32, objectFit: "cover", borderRadius: 5 }} />}
                    <div style={{ flex: 1 }}>
                      <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{eq.name}</p>
                      <p style={{ margin: 0, fontSize: 11, color: "var(--text-muted,#5F7A91)" }}>{eq.category}{eq.total > 1 ? ` · ×${ae.qty}` : ""}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {(job.assignedEquipment || []).length === 0 && (
          <p style={{ fontSize: 12, color: "var(--text-muted,#7B8FA3)", fontStyle: "italic" }}>No equipment assigned yet.</p>
        )}
        {onEdit && (
          <div style={{ display: "flex", justifyContent: "flex-end", paddingTop: 4 }}>
            <button style={{ ...S.btn("primary"), gap: 6, display: "flex", alignItems: "center" }} onClick={() => { onClose(); onEdit(job); }}>
              <Icon d={icons.edit} size={14} /> Edit Job
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ─── DASHBOARD CALENDAR ───────────────────────────────────────────────────────
export function DashboardCalendar({ jobs, equipment, onEdit }) {
  const [calMonth, setCalMonth] = useState(() => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() }; });
  const [detailJob, setDetailJob] = useState(null);

  const { year, month } = calMonth;
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthName = new Date(year, month).toLocaleString("en-GB", { month: "long", year: "numeric" });
  const todayStr = today();

  // Build date string for a given day number
  const ds = (d) => `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

  // For each job, compute which days in this month it occupies
  // and classify consecutive runs as "spans" for rendering bars
  const STATUS_COLORS = {
    Confirmed: { bg: "rgba(47,133,90,0.18)", border: "#2F855A", text: "#2F855A" },
    Pencil:    { bg: "rgba(var(--accent-rgb,37,99,235),0.18)", border: "var(--accent,#2563EB)", text: "var(--accent,#2563EB)" },
    Cancelled: { bg: "rgba(197,48,48,0.12)", border: "#C53030", text: "#C53030" },
    Declined:  { bg: "rgba(148,163,184,0.15)", border: "#7B8794", text: "#7B8794" },
  };

  // For each cell row in the calendar grid, we need to know which job bars
  // are present. Strategy: assign each job a "lane" so bars don't overlap.
  // We work with a flat array of {jobId, day, isStart, isEnd, isContinued} entries.

  const daysInView = [];
  for (let d = 1; d <= daysInMonth; d++) daysInView.push(d);

  // Map: day -> list of jobs active that day
  const jobsOnDay = {};
  daysInView.forEach(d => { jobsOnDay[d] = []; });
  jobs.forEach(job => {
    job.dates.forEach(date => {
      const [y, m, dStr] = date.split("-").map(Number);
      if (y === year && m === month + 1) {
        jobsOnDay[dStr] = jobsOnDay[dStr] || [];
        jobsOnDay[dStr].push(job);
      }
    });
  });

  // Assign lanes per job for visual stacking (greedy)
  // For each job, find the days it spans in this month, assign the lowest free lane
  const jobLane = {};
  const laneOccupied = {}; // lane -> Set of days occupied
  const activeJobs = jobs.filter(j =>
    j.dates.some(date => { const [y,m] = date.split("-").map(Number); return y === year && m === month + 1; })
  );
  activeJobs.forEach(job => {
    const myDays = job.dates
      .filter(date => { const [y,m] = date.split("-").map(Number); return y === year && m === month + 1; })
      .map(date => parseInt(date.split("-")[2]));
    myDays.sort((a, b) => a - b);
    // Find a free lane
    let lane = 0;
    while (true) {
      if (!laneOccupied[lane]) laneOccupied[lane] = new Set();
      const conflict = myDays.some(d => laneOccupied[lane].has(d));
      if (!conflict) break;
      lane++;
    }
    jobLane[job.id] = lane;
    myDays.forEach(d => laneOccupied[lane].add(d));
  });

  const maxLane = Math.max(0, ...Object.values(jobLane));

  // Build calendar grid cells (7 cols)
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  // Pad to complete last row
  while (cells.length % 7 !== 0) cells.push(null);

  // For rendering bars: for each job, for each of its days, we know:
  // isStart = prev day not in job.dates, isEnd = next day not in job.dates
  const getJobDayInfo = (job, d) => {
    const dateStr = ds(d);
    if (!job.dates.includes(dateStr)) return null;
    const prevDs = ds(d - 1);
    const nextDs = ds(d + 1);
    const isStart = !job.dates.includes(prevDs);
    const isEnd = !job.dates.includes(nextDs);
    return { isStart, isEnd };
  };

  // The calendar is 7 columns. Each row of 7 days renders:
  // - day numbers row
  // - one bar row per lane (up to maxLane+1)
  const rows = [];
  for (let r = 0; r < cells.length / 7; r++) {
    rows.push(cells.slice(r * 7, r * 7 + 7));
  }

  const COL_W = `${100/7}%`;

  return (
    <div style={S.card}>
      {/* Month nav */}
      <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
        <button style={{ ...S.btn("ghost"), padding: "4px 10px", fontSize: 16 }}
          onClick={() => setCalMonth(p => { const d = new Date(p.year, p.month - 1); return { year: d.getFullYear(), month: d.getMonth() }; })}>‹</button>
        <span style={{ flex: 1, textAlign: "center", fontWeight: 700, fontSize: 14, color: "var(--text,#16324A)" }}>{monthName}</span>
        <button style={{ ...S.btn("ghost"), padding: "4px 10px", fontSize: 16 }}
          onClick={() => setCalMonth(p => { const d = new Date(p.year, p.month + 1); return { year: d.getFullYear(), month: d.getMonth() }; })}>›</button>
      </div>

      {/* Day headers */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
        {["S","M","T","W","T","F","S"].map((d, i) => (
          <div key={i} style={{ textAlign: "center", fontSize: 10, fontWeight: 700, color: "var(--text-muted,#7B8FA3)", paddingBottom: 6 }}>{d}</div>
        ))}
      </div>

      {/* Rows */}
      {rows.map((rowCells, ri) => (
        <div key={ri}>
          {/* Day number row */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
            {rowCells.map((d, ci) => {
              if (!d) return <div key={"e"+ci} style={{ height: 28 }} />;
              const dateStr = ds(d);
              const isToday = dateStr === todayStr;
              const hasJobs = (jobsOnDay[d] || []).length > 0;
              return (
                <div key={d} style={{ height: 28, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <div style={{
                    width: 24, height: 24, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                    background: isToday ? "var(--accent,#2563EB)" : "transparent",
                    fontSize: 12, fontWeight: isToday ? 800 : hasJobs ? 600 : 400,
                    color: isToday ? "var(--accent-text,#FFFFFF)" : hasJobs ? "var(--text,#16324A)" : "var(--text-muted,#7B8FA3)",
                  }}>{d}</div>
                </div>
              );
            })}
          </div>

          {/* Bar rows — one per lane */}
          {Array.from({ length: maxLane + 1 }).map((_, lane) => {
            // Find jobs in this lane that have days in this row
            const laneJobs = activeJobs.filter(j => jobLane[j.id] === lane);
            const hasAnything = laneJobs.some(j => rowCells.some(d => d && getJobDayInfo(j, d)));
            if (!hasAnything) return null;

            return (
              <div key={lane} style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", marginBottom: 2, height: 20 }}>
                {rowCells.map((d, ci) => {
                  if (!d) return <div key={"e"+ci} />;
                  // Find a job in this lane active on this day
                  const job = laneJobs.find(j => getJobDayInfo(j, d));
                  if (!job) return <div key={d} />;
                  const info = getJobDayInfo(job, d);
                  const col = STATUS_COLORS[job.status] || STATUS_COLORS.Pencil;

                  // Check if next col (same row) also has this job, to determine right-side rounding
                  const nextD = rowCells[ci + 1];
                  const continuesRight = nextD && getJobDayInfo(job, nextD) && !info.isEnd;
                  const prevD = ci > 0 ? rowCells[ci - 1] : null;
                  const continuesLeft = prevD && getJobDayInfo(job, prevD) && !info.isStart;

                  const borderRadius = `${info.isStart ? 6 : 0}px ${info.isEnd || !continuesRight ? 6 : 0}px ${info.isEnd || !continuesRight ? 6 : 0}px ${info.isStart ? 6 : 0}px`;

                  return (
                    <div key={d}
                      onClick={() => setDetailJob(job)}
                      style={{
                        height: 18, background: col.bg, borderTop: `1.5px solid ${col.border}`, borderBottom: `1.5px solid ${col.border}`,
                        borderLeft: info.isStart ? `1.5px solid ${col.border}` : "none",
                        borderRight: info.isEnd || !continuesRight ? `1.5px solid ${col.border}` : "none",
                        borderRadius,
                        cursor: "pointer",
                        overflow: "hidden",
                        display: "flex", alignItems: "center",
                        paddingLeft: info.isStart ? 4 : 0,
                      }}>
                      {info.isStart && (
                        <span style={{ fontSize: 9, fontWeight: 700, color: col.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", lineHeight: 1 }}>
                          {job.name}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}

          {/* Spacer between calendar rows */}
          <div style={{ height: 4 }} />
        </div>
      ))}

      {/* Legend */}
      <div style={{ display: "flex", gap: 14, marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--divider-color,#D8E1EC)" }}>
        {Object.entries(STATUS_COLORS).map(([s, c]) => (
          <div key={s} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <div style={{ width: 18, height: 6, borderRadius: 3, background: c.bg, border: `1px solid ${c.border}` }} />
            <span style={{ fontSize: 10, color: "var(--text-muted,#5F7A91)" }}>{s}</span>
          </div>
        ))}
      </div>

      {/* Job detail modal */}
      {detailJob && <JobDetailModal job={detailJob} equipment={equipment} onClose={() => setDetailJob(null)} onEdit={onEdit} />}
    </div>
  );
}
