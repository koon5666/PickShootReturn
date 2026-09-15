// Tiny app-wide toast (review item P2-4). Mount <ToastProvider> once near the
// root; any component calls `const toast = useToast(); toast("INV-NG-26-0002 created")`
// or `toast(text, { kind: "error" | "success" | "info", ms })`. Renders in the
// white/blue flat theme via CSS vars, bottom-centre, above the mobile bottom nav.
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

const ToastCtx = createContext(() => {});

export function useToast() {
  return useContext(ToastCtx);
}

const KIND_STYLE = {
  success: { borderColor: "rgba(47,133,90,0.45)", dot: "#2F855A" },
  error: { borderColor: "rgba(197,48,48,0.45)", dot: "#C53030" },
  info: { borderColor: "rgba(var(--accent-rgb,37,99,235),0.4)", dot: "var(--accent,#2563EB)" },
};

export function ToastProvider({ children, bottom = 88 }) {
  const [toasts, setToasts] = useState([]);
  const seq = useRef(0);
  const dismiss = useCallback((id) => setToasts(t => t.filter(x => x.id !== id)), []);
  const push = useCallback((text, opts = {}) => {
    if (!text) return;
    const id = ++seq.current;
    const kind = opts.kind || "success";
    const ms = opts.ms || 3500;
    setToasts(t => [...t.slice(-2), { id, text: String(text), kind }]);
    setTimeout(() => dismiss(id), ms);
    return id;
  }, [dismiss]);
  const value = useMemo(() => push, [push]);
  return (
    <ToastCtx.Provider value={value}>
      {children}
      {toasts.length > 0 && (
        <div role="status" aria-live="polite" style={{ position: "fixed", left: 0, right: 0, bottom, display: "flex", flexDirection: "column", alignItems: "center", gap: 8, zIndex: 2000, pointerEvents: "none", padding: "0 16px" }}>
          {toasts.map(t => {
            const ks = KIND_STYLE[t.kind] || KIND_STYLE.info;
            return (
              <div key={t.id} onClick={() => dismiss(t.id)} data-toast={t.kind}
                style={{ pointerEvents: "auto", cursor: "pointer", maxWidth: 420, width: "100%", boxSizing: "border-box", display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 10, background: "var(--surface,#FFFFFF)", color: "var(--text,#16324A)", border: `1px solid ${ks.borderColor}`, boxShadow: "0 4px 16px rgba(22,50,74,0.14)", fontSize: 13, fontWeight: 600, fontFamily: "'Inter','SF Pro Display',system-ui,sans-serif" }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: ks.dot, flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{t.text}</span>
              </div>
            );
          })}
        </div>
      )}
    </ToastCtx.Provider>
  );
}
