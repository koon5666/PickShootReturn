// One accessible Dialog primitive (P2-13). Portal-rendered at document.body so no
// page stacking context (sticky topbar, FAB) can sit above it; role="dialog",
// aria-modal, aria-labelledby; Esc and backdrop click close it (asking first when
// `dirty`); focus moves inside on open, Tab is trapped, and focus returns to the
// opener on close. Nested dialogs work: only the topmost one reacts to Esc.
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
const stack = []; // open dialog ids, last = topmost

export function Dialog({ title, onClose, children, wide, dirty = false, confirmText, closeLabel = "Close", styles, icon, testId }) {
  const id = useId();
  const titleId = `${id}-title`;
  const panelRef = useRef(null);
  const openerRef = useRef(null);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  // Close via Esc / backdrop: honour the dirty hook (a function or a boolean).
  const requestClose = () => {
    if (!onClose) return;
    const isDirty = typeof dirtyRef.current === "function" ? dirtyRef.current() : !!dirtyRef.current;
    if (isDirty && !window.confirm(confirmText || "Discard your changes?")) return;
    onClose();
  };

  useEffect(() => {
    stack.push(id);
    openerRef.current = document.activeElement;
    // Focus the first control (not the close button, which is first in DOM) or the panel.
    const panel = panelRef.current;
    if (panel) {
      const nodes = [...panel.querySelectorAll(FOCUSABLE)].filter(n => n.offsetParent !== null || n === panel);
      const first = nodes.find(n => !n.hasAttribute("data-dialog-close")) || nodes[0] || panel;
      try { first.focus({ preventScroll: true }); } catch {}
    }
    const onKey = (e) => {
      if (stack[stack.length - 1] !== id) return;
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); requestClose(); return; }
      if (e.key === "Tab" && panelRef.current) {
        const nodes = [...panelRef.current.querySelectorAll(FOCUSABLE)].filter(n => n.offsetParent !== null);
        if (nodes.length === 0) { e.preventDefault(); panelRef.current.focus(); return; }
        const first = nodes[0], last = nodes[nodes.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && (active === first || !panelRef.current.contains(active))) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && (active === last || !panelRef.current.contains(active))) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      const i = stack.lastIndexOf(id); if (i >= 0) stack.splice(i, 1);
      const back = openerRef.current;
      if (back && typeof back.focus === "function" && document.contains(back)) { try { back.focus({ preventScroll: true }); } catch {} }
    };
  }, []); // eslint-disable-line

  const st = styles || {};
  const node = (
    <div
      data-dialog-backdrop
      onMouseDown={(e) => { if (e.target === e.currentTarget) requestClose(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(22,50,74,0.45)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, ...(st.backdrop || {}) }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid={testId}
        style={{ background: "var(--surface,#FFFFFF)", border: "1px solid var(--border-color,#D8E1EC)", borderRadius: 12, width: "100%", maxWidth: wide ? 700 : 480, maxHeight: "90vh", overflow: "auto", outline: "none", ...(st.panel || {}) }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "18px 24px", borderBottom: "1px solid var(--divider-color,#D8E1EC)", ...(st.header || {}) }}>
          <h3 id={titleId} style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{title}</h3>
          <button type="button" data-dialog-close onClick={onClose} aria-label={closeLabel} title={closeLabel} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 36, minHeight: 36, padding: "4px 8px", background: "transparent", color: "var(--text-muted,#4E6B84)", border: "var(--input-border,1px solid #D8E1EC)", borderRadius: "var(--btn-radius,7px)", cursor: "pointer", ...(st.close || {}) }}>
            {icon || <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18 M6 6l12 12" /></svg>}
          </button>
        </div>
        <div style={{ padding: 24, ...(st.body || {}) }}>{children}</div>
      </div>
    </div>
  );
  return typeof document !== "undefined" ? createPortal(node, document.body) : node;
}
export default Dialog;
