#!/usr/bin/env node
// Boot an ISOLATED local PickShootReturn (wrangler pages dev over ./dist) detached.
//
//   node tests/local-server.mjs <PORT> <stateDir> [--session <name>] [--no-build]
//   node tests/local-server.mjs stop <stateDir>
//
// - Refuses a port that is already listening (never reclaims another session's server).
// - State (local KV) lives in <stateDir> (--persist-to), so nothing touches the real KV.
// - Writes <stateDir>/wrangler.pid + <stateDir>/wrangler.log, waits until
//   GET /api/public answers 200, prints the PID, exits (the server keeps running).
// - --session <name> registers the server in /tmp/claude-dev-servers.json; `stop`
//   kills ONLY the PID recorded in <stateDir>/wrangler.pid (its process group) and
//   removes that registry entry.
// Never deploys, never reads .env.
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createConnection } from "node:net";
import { randomBytes } from "node:crypto";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REGISTRY = "/tmp/claude-dev-servers.json";
const args = process.argv.slice(2);

const usage = () => { console.error("usage: node tests/local-server.mjs <PORT> <stateDir> [--session <name>] [--no-build]\n       node tests/local-server.mjs stop <stateDir>"); process.exit(2); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function portInUse(port) {
  return new Promise(res => {
    const s = createConnection({ port, host: "127.0.0.1" });
    s.once("connect", () => { s.destroy(); res(true); });
    s.once("error", () => res(false));
  });
}
function readRegistry() {
  try { const v = JSON.parse(readFileSync(REGISTRY, "utf8")); return Array.isArray(v) ? v : []; } catch { return []; }
}
function writeRegistry(list) { try { writeFileSync(REGISTRY, JSON.stringify(list, null, 1) + "\n"); } catch (e) { console.warn("registry write failed:", e.message); } }

if (args[0] === "stop") {
  const stateDir = resolve(args[1] || usage());
  const pidFile = join(stateDir, "wrangler.pid");
  if (!existsSync(pidFile)) { console.error("no pid file at " + pidFile); process.exit(1); }
  const pid = parseInt(readFileSync(pidFile, "utf8"), 10);
  if (!(pid > 1)) { console.error("bad pid in " + pidFile); process.exit(1); }
  for (const sig of ["SIGTERM", "SIGKILL"]) {
    try { process.kill(-pid, sig); } catch {}      // whole process group (wrangler + workerd)
    try { process.kill(pid, sig); } catch {}
    await sleep(sig === "SIGTERM" ? 1500 : 200);
    let alive = true; try { process.kill(pid, 0); } catch { alive = false; }
    if (!alive) break;
  }
  try { unlinkSync(pidFile); } catch {}
  writeRegistry(readRegistry().filter(e => e.pid !== pid));
  console.log(`stopped pid ${pid}, registry entry removed`);
  process.exit(0);
}

const port = parseInt(args[0], 10);
const stateDir = args[1] ? resolve(args[1]) : null;
if (!(port > 0) || !stateDir) usage();
const sessIdx = args.indexOf("--session");
const session = sessIdx >= 0 ? args[sessIdx + 1] : null;
const noBuild = args.includes("--no-build");

if (await portInUse(port)) {
  console.error(`port ${port} is already in use. Pick a free one (lsof -nP -iTCP:${port}); never kill a listener you did not start.`);
  process.exit(1);
}
const wranglerBin = join(ROOT, "node_modules", ".bin", "wrangler");
if (!existsSync(wranglerBin)) { console.error("wrangler not installed: run npm install"); process.exit(1); }
if (!noBuild || !existsSync(join(ROOT, "dist", "index.html"))) {
  console.log("building dist (vite build)…");
  execFileSync(join(ROOT, "node_modules", ".bin", "vite"), ["build"], { cwd: ROOT, stdio: "inherit" });
}
// Auth (P0-2): the functions refuse to run without SESSION_SECRET. Locally it
// comes from .dev.vars (gitignored); create one with a random secret if missing.
const devVars = join(ROOT, ".dev.vars");
if (!existsSync(devVars) || !/^SESSION_SECRET=\S+/m.test(readFileSync(devVars, "utf8"))) {
  const existing = existsSync(devVars) ? readFileSync(devVars, "utf8").replace(/\s*$/, "\n") : "";
  writeFileSync(devVars, `${existing}SESSION_SECRET=${randomBytes(32).toString("hex")}\n`);
  console.log(`wrote SESSION_SECRET to ${devVars} (local only; prod uses the Pages secret)`);
}
mkdirSync(stateDir, { recursive: true });
const logPath = join(stateDir, "wrangler.log");
const logFd = openSync(logPath, "a");
const cmdArgs = ["pages", "dev", "dist", "--port", String(port), "--persist-to", stateDir];
const child = spawn(wranglerBin, cmdArgs, {
  cwd: ROOT, detached: true, stdio: ["ignore", logFd, logFd],
  env: { ...process.env, CI: "1", WRANGLER_SEND_METRICS: "false", NO_COLOR: "1" },
});
child.unref();
writeFileSync(join(stateDir, "wrangler.pid"), String(child.pid));
console.log(`wrangler pages dev pid ${child.pid}, log ${logPath}`);

const base = `http://127.0.0.1:${port}`;
const deadline = Date.now() + 120_000;
let ok = false;
while (Date.now() < deadline) {
  let alive = true; try { process.kill(child.pid, 0); } catch { alive = false; }
  if (!alive) { console.error("wrangler exited early, see " + logPath); process.exit(1); }
  try {
    const r = await fetch(base + "/api/public");
    if (r.status === 200) { ok = true; break; }
  } catch {}
  await sleep(500);
}
if (!ok) { console.error("timed out waiting for GET /api/public 200, see " + logPath); process.exit(1); }

if (session) {
  const list = readRegistry().filter(e => e.pid !== child.pid);
  list.push({ port, pid: child.pid, project: "PickShootReturn", purpose: "local isolated test server (wrangler pages dev, --persist-to " + stateDir + ")", session, cmd: `wrangler ${cmdArgs.join(" ")}`, started: new Date().toISOString() });
  writeRegistry(list);
  console.log(`registered in ${REGISTRY} (session ${session})`);
}
console.log(`READY ${base}  pid=${child.pid}`);
console.log(`stop with: node tests/local-server.mjs stop ${stateDir}`);
