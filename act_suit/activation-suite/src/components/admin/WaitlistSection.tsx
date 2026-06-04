"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminModal, type ModalCfg } from "@/components/admin/AdminModal";

const C = {
  ink: "#1a1614", ink2: "#5b5550", ink3: "#9a948e", line: "#e9e4dc", bg: "#f6f3ee",
  panel: "#ffffff", green: "#2d7a3e", greenBg: "#e7f3ea", red: "#c0392b", redBg: "#fbeae8",
  amber: "#b5821e", amberBg: "#fbf2df", blue: "#3b6cd9", orange: "#e07b3c", orangeBg: "#fbf0e7",
};

type Entry = {
  email: string; name: string | null; role: string | null; reason: string | null;
  status: string; inviteCode: string | null; createdAt: string | null; invitedAt: string | null;
};

function fmt(iso: string | null): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "2-digit" }); } catch { return iso; }
}

const STATUS_COLOR: Record<string, [string, string]> = {
  pending: [C.amber, C.amberBg], invited: [C.blue, "#e7eefb"], converted: [C.green, C.greenBg], rejected: [C.red, C.redBg],
};

export function WaitlistSection() {
  const [rows, setRows] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ msg: string; ok: boolean } | null>(null);
  const [filter, setFilter] = useState<string>("");
  const [modal, setModal] = useState<ModalCfg>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const q = filter ? `?status=${filter}` : "";
    const r = await fetch(`/api/v1/admin/waitlist${q}`).then((x) => x.json()).catch(() => ({}));
    if (r?.ok) setRows(r.waitlist || []);
    setLoading(false);
  }, [filter]);
  useEffect(() => { load(); }, [load]);

  function confirmInvite(e: Entry) {
    setModal({
      title: e.status === "invited" ? "Re-invite to beta" : "Invite to beta",
      tone: "primary",
      context: [
        { label: "Email", value: e.email },
        { label: "Name", value: e.name || "—" },
        { label: "Status", value: e.status },
        ...(e.inviteCode ? [{ label: "Previous code", value: e.inviteCode }] : []),
      ],
      body: "Generates a single-use invite code and emails it to this person so they can claim a founding-member spot.",
      confirmText: e.status === "invited" ? "Re-invite & email" : "Invite & email",
      onConfirm: () => act(e.email, "invite", e.name || undefined),
    });
  }
  function confirmReject(e: Entry) {
    setModal({
      title: "Reject from waitlist",
      tone: "danger",
      context: [
        { label: "Email", value: e.email },
        { label: "Name", value: e.name || "—" },
        { label: "Status", value: e.status },
      ],
      body: "Marks this person as rejected — they won't be invited. You can still invite them later.",
      confirmText: "Reject",
      onConfirm: () => act(e.email, "reject"),
    });
  }

  async function act(email: string, action: "invite" | "reject", name?: string) {
    setBusy(email); setNote(null);
    const r = await fetch("/api/v1/admin/waitlist", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, email, name }),
    }).then((x) => x.json()).catch(() => ({}));
    setBusy(null);
    if (r?.ok) {
      setNote({
        msg: action === "invite"
          ? `Invited ${email} — code ${r.code}${r.emailed ? " (emailed ✓)" : r.email_skipped ? " (email skipped — no key configured)" : " (email failed)"}`
          : `Rejected ${email}`,
        ok: true,
      });
    } else {
      setNote({ msg: `Failed: ${r?.error || "error"}`, ok: false });
    }
    load();
  }

  const counts = rows.reduce((m, r) => { m[r.status] = (m[r.status] || 0) + 1; return m; }, {} as Record<string, number>);

  return (
    <div>
      {note ? <div style={{ fontSize: 13, marginBottom: 12, padding: "8px 12px", borderRadius: 8, background: note.ok ? C.greenBg : C.redBg, color: note.ok ? C.green : C.red }}>{note.msg}</div> : null}

      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        {["", "pending", "invited", "converted", "rejected"].map((s) => (
          <button key={s || "all"} onClick={() => setFilter(s)} style={{
            padding: "6px 12px", borderRadius: 8, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
            border: `1px solid ${filter === s ? C.orange : C.line}`,
            background: filter === s ? C.orangeBg : C.panel, color: filter === s ? C.orange : C.ink2,
          }}>{s ? `${s}${counts[s] ? ` (${counts[s]})` : ""}` : "all"}</button>
        ))}
        <button onClick={load} style={{ marginLeft: "auto", padding: "6px 12px", borderRadius: 8, border: `1px solid ${C.line}`, background: C.panel, color: C.ink, fontWeight: 600, fontSize: 12.5, cursor: "pointer" }}>↻ Refresh</button>
      </div>

      <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr style={{ textAlign: "left", color: C.ink3 }}>
              {["Email", "Name", "Role", "Reason", "Status", "Joined", ""].map((h, i) => (
                <th key={i} style={{ padding: "12px 14px", fontWeight: 600, fontSize: 11.5, textTransform: "uppercase", letterSpacing: ".04em", borderBottom: `1px solid ${C.line}`, whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} style={{ padding: 28, textAlign: "center", color: C.ink3 }}>Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} style={{ padding: 28, textAlign: "center", color: C.ink3 }}>No waitlist entries{filter ? ` (${filter})` : ""}.</td></tr>
              ) : rows.map((r, idx) => {
                const [fg, bg] = STATUS_COLOR[r.status] || [C.ink2, C.bg];
                return (
                  <tr key={r.email} style={{ background: idx % 2 ? "#fcfbf9" : C.panel }}>
                    <td style={{ padding: "11px 14px", borderBottom: `1px solid ${C.line}`, fontWeight: 600 }}>{r.email}{r.inviteCode ? <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, color: C.orange, marginTop: 2 }}>{r.inviteCode}</div> : null}</td>
                    <td style={{ padding: "11px 14px", borderBottom: `1px solid ${C.line}`, color: C.ink2 }}>{r.name || "—"}</td>
                    <td style={{ padding: "11px 14px", borderBottom: `1px solid ${C.line}`, color: C.ink2 }}>{r.role || "—"}</td>
                    <td style={{ padding: "11px 14px", borderBottom: `1px solid ${C.line}`, color: C.ink3, fontSize: 12, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.reason || ""}>{r.reason || "—"}</td>
                    <td style={{ padding: "11px 14px", borderBottom: `1px solid ${C.line}` }}><span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 6, background: bg, color: fg }}>{r.status}</span></td>
                    <td style={{ padding: "11px 14px", borderBottom: `1px solid ${C.line}`, color: C.ink3, whiteSpace: "nowrap" }}>{fmt(r.createdAt)}</td>
                    <td style={{ padding: "8px 14px", borderBottom: `1px solid ${C.line}`, textAlign: "right", whiteSpace: "nowrap" }}>
                      {r.status === "pending" || r.status === "rejected" ? (
                        <button onClick={() => confirmInvite(r)} disabled={busy === r.email} style={{ padding: "6px 12px", borderRadius: 8, border: "none", background: C.orange, color: "#fff", fontWeight: 700, fontSize: 12, cursor: "pointer", marginRight: 6 }}>
                          {busy === r.email ? "…" : "Invite"}
                        </button>
                      ) : r.status === "invited" ? (
                        <button onClick={() => confirmInvite(r)} disabled={busy === r.email} style={{ padding: "6px 12px", borderRadius: 8, border: `1px solid ${C.line}`, background: C.panel, color: C.ink2, fontWeight: 600, fontSize: 12, cursor: "pointer", marginRight: 6 }}>
                          {busy === r.email ? "…" : "Re-invite"}
                        </button>
                      ) : null}
                      {r.status !== "rejected" ? (
                        <button onClick={() => confirmReject(r)} disabled={busy === r.email} style={{ padding: "6px 10px", borderRadius: 8, border: `1px solid ${C.line}`, background: C.panel, color: C.red, fontWeight: 600, fontSize: 12, cursor: "pointer" }}>Reject</button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <AdminModal cfg={modal} busy={!!busy} onClose={() => setModal(null)} />
    </div>
  );
}
