import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";

// A view chunk that cannot be fetched (P3-8 code split):
//  - during the background warm-up (App.jsx prefetchAdminViews sets
//    window.__psrPrefetching) the failure is swallowed: nothing reloads, nothing
//    throws, the chunk is simply fetched again when a page really needs it;
//  - offline (navigator.onLine false) nothing reloads either: the view boundary
//    in App.jsx shows its card, a reload would only land on a browser error page;
//  - otherwise the most likely cause is a deploy that replaced the hashed files
//    under this open tab, so the page reloads ONCE per session to pick up the new
//    index.html; a second failure falls through to the view boundary.
window.addEventListener("vite:preloadError", (e) => {
  if (window.__psrPrefetching) { e.preventDefault(); return; }
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  let again = false;
  try { again = sessionStorage.getItem("psr_chunk_reload") === "1"; if (!again) sessionStorage.setItem("psr_chunk_reload", "1"); } catch {}
  if (!again) { e.preventDefault(); window.location.reload(); }
});

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
