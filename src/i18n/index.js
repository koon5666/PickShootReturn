// Merged translation table: base dictionary + every fix track in ./tracks/*.js.
// Tracks are plain ESM modules that default-export { en: {...}, th: {...} }.
// The glob is Vite-only; node tooling (scripts/i18n-diff.mjs) reads the tracks
// directory itself and reuses mergeTracks so the result is identical.
import { LANG as BASE } from "./base.js";
import { mergeTracks } from "./merge.js";

const modules = import.meta.glob("./tracks/*.js", { eager: true });
const tracks = Object.keys(modules).sort().map(path => ({
  name: path.replace(/^\.\/tracks\//, "").replace(/\.js$/, ""),
  dict: modules[path],
}));

export const { LANG } = mergeTracks(BASE, tracks);
export default LANG;
