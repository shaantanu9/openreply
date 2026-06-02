"use client";

import { useCallback, useEffect, useState } from "react";

type LicenseRow = {
  email: string;
  status: string;
  planId: string;
  maxDevices: number;
  devicesUsed: number;
  activationKeyPreview: string | null;
  isTrial: boolean;
  expiresAt: string | null;
};

const wrap: React.CSSProperties = { maxWidth: 860, margin: "48px auto", padding: "0 20px", fontFamily: "system-ui, sans-serif", color: "#1a1614" };
const input: React.CSSProperties = { width: "100%", padding: "10px 12px", border: "1px solid #ddd", borderRadius: 8, fontSize: 14 };
const btn = (bg: string, fg = "#fff", border = "none"): React.CSSProperties => ({ padding: "8px 14px", borderRadius: 8, border, background: bg, color: fg, fontWeight: 600, cursor: "pointer", fontSize: 13 });

export default function AdminPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [configured, setConfigured] = useState(true);
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [rows, setRows] = useState<LicenseRow[]>([]);
  const [masterOn, setMasterOn] = useState(false);

  const loadSession = useCallback(async () => {
    const r = await fetch("/api/v1/admin/auth").then((x) => x.json()).catch(() => ({}));
    setConfigured(Boolean(r.configured));
    setAuthed(Boolean(r.authed));
    if (r.authed) loadLicenses();
  }, []);

  const loadLicenses = useCallback(async () => {
    const r = await fetch("/api/v1/admin/licenses").then((x) => x.json()).catch(() => ({}));
    if (r.ok) { setRows(r.licenses || []); setMasterOn(Boolean(r.master_key_enabled)); }
  }, []);

  useEffect(() => { loadSession(); }, [loadSession]);

  async function login() {
    setBusy("login"); setNote(null);
    const r = await fetch("/api/v1/admin/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "login", secret }) }).then((x) => x.json()).catch(() => ({}));
    setBusy(null);
    if (r.authed) { setSecret(""); setAuthed(true); loadLicenses(); }
    else setNote("Wrong secret.");
  }
  async function logout() {
    await fetch("/api/v1/admin/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "logout" }) });
    setAuthed(false); setRows([]);
  }
  async function act(email: string, action: "revoke" | "reactivate" | "expire") {
    setBusy(email + action); setNote(null);
    const r = await fetch("/api/v1/admin/license", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, email }) }).then((x) => x.json()).catch(() => ({}));
    setBusy(null);
    setNote(r.ok ? `${email}: ${action} ✓` : `${email}: ${r.error || "failed"}`);
    loadLicenses();
  }

  if (authed === null) return <main style={wrap}>Loading…</main>;

  if (!configured) {
    return <main style={wrap}><h1>License admin</h1><p style={{ color: "#c0392b" }}>Set <code>ADMIN_SECRET</code> in the server env to enable admin.</p></main>;
  }

  if (!authed) {
    return (
      <main style={{ ...wrap, maxWidth: 420 }}>
        <h1 style={{ fontSize: 24 }}>Admin login</h1>
        <p style={{ color: "#6b6b6b", fontSize: 14, marginBottom: 20 }}>Enter the owner secret to manage licenses.</p>
        <input type="password" value={secret} placeholder="ADMIN_SECRET" style={{ ...input, marginBottom: 14 }}
          onChange={(e) => setSecret(e.target.value)} onKeyDown={(e) => e.key === "Enter" && login()} />
        <button onClick={login} disabled={busy === "login"} style={btn("#1a1614")}>{busy === "login" ? "Signing in…" : "Sign in"}</button>
        {note ? <p style={{ color: "#c0392b", marginTop: 12, fontSize: 13 }}>{note}</p> : null}
      </main>
    );
  }

  return (
    <main style={wrap}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <h1 style={{ fontSize: 24, margin: 0 }}>License admin</h1>
        <button onClick={logout} style={btn("#fff", "#333", "1px solid #ddd")}>Log out</button>
      </div>
      <p style={{ color: "#6b6b6b", fontSize: 13, marginBottom: 16 }}>
        Disable a key (the desktop app locks on next check), re-enable, or expire it.
        Beta master key: <strong style={{ color: masterOn ? "#0f6e56" : "#c0392b" }}>{masterOn ? "ENABLED" : "off"}</strong>{" "}
        (rotate/clear <code>MASTER_KEY</code> in env to change/revoke).
      </p>
      {note ? <p style={{ fontSize: 13, marginBottom: 12, color: note.includes("✓") ? "#0f6e56" : "#c0392b" }}>{note}</p> : null}
      <div style={{ overflowX: "auto", border: "1px solid #eee", borderRadius: 10 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#faf8f4", textAlign: "left" }}>
              {["Email", "Status", "Plan", "Devices", "Key", "Actions"].map((h) => (
                <th key={h} style={{ padding: "10px 12px", fontWeight: 600 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: 20, textAlign: "center", color: "#999" }}>No licenses yet.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.email + r.activationKeyPreview} style={{ borderTop: "1px solid #eee" }}>
                <td style={{ padding: "10px 12px" }}>{r.email}</td>
                <td style={{ padding: "10px 12px", color: r.status === "active" ? "#0f6e56" : "#c0392b", fontWeight: 600 }}>{r.status}</td>
                <td style={{ padding: "10px 12px" }}>{r.planId}{r.isTrial ? " (trial)" : ""}</td>
                <td style={{ padding: "10px 12px" }}>{r.devicesUsed}/{r.maxDevices}</td>
                <td style={{ padding: "10px 12px", fontFamily: "monospace" }}>…{r.activationKeyPreview || "????"}</td>
                <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                  <button onClick={() => act(r.email, "revoke")} disabled={!!busy} style={{ ...btn("#c0392b"), marginRight: 6 }}>Disable</button>
                  <button onClick={() => act(r.email, "reactivate")} disabled={!!busy} style={{ ...btn("#0f6e56"), marginRight: 6 }}>Enable</button>
                  <button onClick={() => act(r.email, "expire")} disabled={!!busy} style={btn("#fff", "#333", "1px solid #ddd")}>Expire</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
