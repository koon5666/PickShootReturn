// Merge track dictionaries on top of the base LANG. Plain ESM, no Vite-isms, so
// both the app (src/i18n/index.js) and node scripts (scripts/i18n-diff.mjs,
// vitest) share one implementation.
//
// tracks: array of { name, dict } where dict = { en: {...}, th: {...} }
// (the default export of a src/i18n/tracks/<track>.js module).
// A track key that already exists in base or in an earlier track OVERRIDES it
// (that is the only sanctioned way for a fix track to reword a base string);
// every override is reported in `overrides` so the diff script can surface it.
export const LANG_CODES = ["en", "th"];

export function mergeTracks(base, tracks) {
  const merged = {};
  for (const code of LANG_CODES) merged[code] = { ...(base?.[code] || {}) };
  const overrides = [];
  const owner = {}; // "code:key" -> track name that set it (base = "base")
  for (const [i, track] of (tracks || []).entries()) {
    const name = track?.name || `track#${i}`;
    const dict = track?.dict?.default || track?.dict || {};
    for (const code of LANG_CODES) {
      const part = dict[code];
      if (!part || typeof part !== "object") continue;
      for (const [key, val] of Object.entries(part)) {
        const id = `${code}:${key}`;
        if (key in merged[code]) overrides.push({ code, key, track: name, previous: owner[id] || "base" });
        merged[code][key] = val;
        owner[id] = name;
      }
    }
  }
  return { LANG: merged, overrides };
}

// Keys present in one language and missing in the other.
export function diffKeys(dict) {
  const en = Object.keys(dict?.en || {});
  const th = new Set(Object.keys(dict?.th || {}));
  const enSet = new Set(en);
  return {
    missingInTh: en.filter(k => !th.has(k)),
    missingInEn: [...th].filter(k => !enSet.has(k)),
  };
}
