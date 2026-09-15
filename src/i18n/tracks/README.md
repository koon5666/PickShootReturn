# i18n tracks

One file per work track, e.g. `checkout.js`, `invoice.js`, `p0-availability.js`.
Plain ESM (node must be able to import it, no JSX, no Vite-only syntax):

```js
export default {
  en: { myKey: "English copy" },
  th: { myKey: "ภาษาไทยแบบหน้างาน" },
};
```

Rules

- Every EN key needs its TH twin (`npm run i18n:check` fails otherwise).
- Never edit `src/i18n/base.js` from a track. A track key that already exists in
  base overrides it, and the diff script prints every override so reviewers see it.
- Copy style: natural shop-floor Thai, no em dashes or "--" as sentence punctuation.
- Use it in the app the usual way: `const t = useT(); t("myKey")`.
