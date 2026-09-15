#!/usr/bin/env node
// Reports EN keys missing in TH (and vice versa) across the base dictionary and
// every track in src/i18n/tracks/*.js. Exit 1 on any mismatch.
//   node scripts/i18n-diff.mjs          (npm run i18n:check)
import { readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { LANG as BASE } from "../src/i18n/base.js";
import { mergeTracks, diffKeys } from "../src/i18n/merge.js";

const here = dirname(fileURLToPath(import.meta.url));
const tracksDir = join(here, "..", "src", "i18n", "tracks");

let files = [];
try { files = readdirSync(tracksDir).filter(f => f.endsWith(".js")).sort(); } catch { files = []; }

let failed = false;
const report = (label, d) => {
  if (d.missingInTh.length) { failed = true; console.log(`  [${label}] EN keys missing in TH (${d.missingInTh.length}): ${d.missingInTh.join(", ")}`); }
  if (d.missingInEn.length) { failed = true; console.log(`  [${label}] TH keys missing in EN (${d.missingInEn.length}): ${d.missingInEn.join(", ")}`); }
  if (!d.missingInTh.length && !d.missingInEn.length) console.log(`  [${label}] ok`);
};

console.log("i18n check");
report("base", diffKeys(BASE));

const tracks = [];
for (const f of files) {
  const mod = await import(pathToFileURL(join(tracksDir, f)).href);
  const dict = mod.default || mod;
  if (!dict || typeof dict !== "object" || (!dict.en && !dict.th)) {
    failed = true; console.log(`  [tracks/${f}] does not default-export { en, th }`); continue;
  }
  tracks.push({ name: f.replace(/\.js$/, ""), dict });
  report(`tracks/${f}`, diffKeys(dict));
}

const { LANG, overrides } = mergeTracks(BASE, tracks);
for (const o of overrides) console.log(`  note: tracks/${o.track}.js overrides ${o.code}.${o.key} (was set by ${o.previous})`);
report("merged", diffKeys(LANG));
console.log(`  ${Object.keys(LANG.en).length} EN / ${Object.keys(LANG.th).length} TH keys, ${tracks.length} track(s)`);

if (failed) { console.log("i18n check FAILED"); process.exit(1); }
console.log("i18n check passed");
