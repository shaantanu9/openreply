"use client";

import { useEffect, useState, type ReactNode } from "react";

const C = {
  ink: "#1a1614", ink2: "#5b5550", ink3: "#9a948e", line: "#e9e4dc",
  panel: "#ffffff", red: "#c0392b", orange: "#e07b3c",
};

/**
 * Shared admin action modal — replaces window.confirm / prompt across the admin
 * console. Shows a "Current state" panel (the thing's previous state) plus an
 * optional input, so the operator has full context before acting.
 */
export type ModalCfg = {
  title: string;
  tone?: "default" | "danger" | "primary";
  context?: { label: string; value: ReactNode }[];
  body?: string;
  input?: { kind: "number" | "password" | "text"; label: string; placeholder?: string; default?: string; hint?: string; minLen?: number };
  requireMatch?: string; // confirm value must equal this (case-insensitive)
  confirmText: string;
  onConfirm: (value: string) => void;
} | null;

export function AdminModal({ cfg, busy, onClose }: { cfg: ModalCfg; busy: boolean; onClose: () => void }) {
  const [val, setVal] = useState("");
  useEffect(() => { setVal(cfg?.input?.default ?? ""); }, [cfg]);
  if (!cfg) return null;
  const accent = cfg.tone === "danger" ? C.red : cfg.tone === "primary" ? C.ink : C.orange;
  let enabled = true;
  if (cfg.requireMatch != null) enabled = val.trim().toLowerCase() === cfg.requireMatch.toLowerCase();
  else if (cfg.input?.kind === "number") enabled = !!parseInt(val, 10);
  else if (cfg.input?.minLen) enabled = val.length >= cfg.input.minLen;
  else if (cfg.input) enabled = val.trim().length > 0;
  const submit = () => { if (enabled && !busy) { cfg.onConfirm(val); onClose(); } };
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(20,16,14,.45)", display: "grid", placeItems: "center", zIndex: 50, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 460, background: C.panel, borderRadius: 16, boxShadow: "0 24px 64px rgba(0,0,0,.28)", overflow: "hidden", fontFamily: "system-ui" }}>
        <div style={{ padding: "18px 22px 0" }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: C.ink }}>{cfg.title}</h2>
        </div>
        {cfg.context?.length ? (
          <div style={{ margin: "14px 22px 0", border: `1px solid ${C.line}`, borderRadius: 12, background: "#fbfaf8", padding: "10px 14px" }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: C.ink3, marginBottom: 6 }}>Current state</div>
            {cfg.context.map((row, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "3px 0", fontSize: 13 }}>
                <span style={{ color: C.ink3 }}>{row.label}</span>
                <span style={{ color: C.ink, fontWeight: 600, textAlign: "right", wordBreak: "break-word" }}>{row.value}</span>
              </div>
            ))}
          </div>
        ) : null}
        {cfg.body ? <p style={{ margin: "14px 22px 0", fontSize: 13.5, lineHeight: 1.55, color: C.ink2 }}>{cfg.body}</p> : null}
        {cfg.input ? (
          <div style={{ margin: "14px 22px 0" }}>
            <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: C.ink2, marginBottom: 6 }}>{cfg.input.label}</label>
            <input
              autoFocus
              type={cfg.input.kind === "password" ? "password" : "text"}
              inputMode={cfg.input.kind === "number" ? "numeric" : undefined}
              value={val}
              placeholder={cfg.input.placeholder}
              onChange={(e) => setVal(cfg.input!.kind === "number" ? e.target.value.replace(/[^0-9-]/g, "") : e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              style={{ width: "100%", padding: "10px 12px", border: `1px solid ${C.line}`, borderRadius: 10, fontSize: 14, boxSizing: "border-box", fontFamily: cfg.requireMatch ? "ui-monospace, monospace" : "inherit" }}
            />
            {cfg.input.hint ? <div style={{ fontSize: 11.5, color: C.ink3, marginTop: 5 }}>{cfg.input.hint}</div> : null}
          </div>
        ) : null}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "18px 22px 20px" }}>
          <button onClick={onClose} style={{ padding: "9px 16px", borderRadius: 9, border: `1px solid ${C.line}`, background: C.panel, color: C.ink2, fontWeight: 600, fontSize: 13, cursor: "pointer" }}>Cancel</button>
          <button onClick={submit} disabled={!enabled || busy} style={{ padding: "9px 18px", borderRadius: 9, border: "none", background: accent, color: "#fff", fontWeight: 700, fontSize: 13, cursor: enabled && !busy ? "pointer" : "not-allowed", opacity: enabled && !busy ? 1 : 0.5 }}>{cfg.confirmText}</button>
        </div>
      </div>
    </div>
  );
}
