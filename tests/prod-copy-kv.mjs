#!/usr/bin/env node
// Load the prod copy (~/psr-backups/2026-09-16_pre-theme/data-full.json, photos
// still INLINE) straight into a LOCAL KV state dir, bypassing PUT /api/data
// (which would externalize the photos on the way in). This reproduces the real
// pre-migration storage shape so tests/migrate-proof.mjs can prove the migration.
//
//   node tests/prod-copy-kv.mjs <stateDir>      then boot: node tests/local-server.mjs <PORT> <stateDir> --no-build
//
// Only ever writes to <stateDir> via `wrangler kv bulk put --local`. lineGroupId
// is nulled so no local run can reach the real LINE group. Never touches the real KV.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stateDir = process.argv[2] ? resolve(process.argv[2]) : null;
if (!stateDir) { console.error("usage: node tests/prod-copy-kv.mjs <stateDir>"); process.exit(2); }
const SRC = join(homedir(), "psr-backups", "2026-09-16_pre-theme", "data-full.json");
const d = JSON.parse(readFileSync(SRC, "utf8"));
d.lineGroupId = null;
const rows = Object.entries(d).filter(([, v]) => v !== null && v !== undefined).map(([key, value]) => ({ key, value: JSON.stringify(value) }));
mkdirSync(stateDir, { recursive: true });
const bulk = join(tmpdir(), `psr-prod-bulk-${process.pid}.json`);
writeFileSync(bulk, JSON.stringify(rows));
execFileSync(join(ROOT, "node_modules", ".bin", "wrangler"), ["kv", "bulk", "put", bulk, "--binding", "KV", "--local", "--persist-to", stateDir], { cwd: ROOT, stdio: "inherit" });
console.log(`loaded ${rows.length} keys (${(rows.reduce((n, r) => n + r.value.length, 0) / 1048576).toFixed(1)} MiB, photos inline) into ${stateDir}`);
