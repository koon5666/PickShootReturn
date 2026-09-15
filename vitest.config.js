import { defineConfig } from "vitest/config";

// Unit tests for pure logic only (node environment, no DOM):
//   src/logic/**       client-side modules imported by App.jsx
//   functions/_lib/**  server-side helpers imported by the Pages Functions
//   src/i18n/**        dictionary merge
// Never put *.test.js under functions/api/ (every file there becomes a route).
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.js", "functions/**/*.test.js"],
    exclude: ["node_modules/**", "dist/**", ".wrangler/**", ".wrangler-local/**"],
  },
});
