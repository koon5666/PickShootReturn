import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    rollupOptions: {
      output: {
        // P3-8: stable, separately cached chunks. jsQR is already a dynamic import
        // (loaded the first time a scanner opens); React and the bilingual
        // dictionary change far less often than App.jsx, so a copy deploy only
        // re-downloads the app chunk. The views are split by route in App.jsx
        // (React.lazy over src/views/{crew,admin,invoice,settings,calendar}.jsx):
        // the main chunk is the login screen + shell + src/ui/shared.jsx, a crew
        // session never downloads the admin pages and vice versa.
        manualChunks(id) {
          if (id.includes("node_modules/react") || id.includes("node_modules/scheduler")) return "vendor-react";
          if (id.includes("/src/i18n/")) return "i18n";
          if (id.includes("/src/vendor/")) return "vendor-qr";
        },
      },
    },
  },
});
