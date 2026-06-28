"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { CouponsSection } from "@/components/admin/CouponsSection";
import { WaitlistSection } from "@/components/admin/WaitlistSection";
import { AdminModal, type ModalCfg } from "@/components/admin/AdminModal";

type Subject = {
  email: string; status: string; planId: string; isTrial: boolean;
  maxDevices: number; devicesUsed: number; expiresAt: string | null;
  trialEndsAt: string | null; createdAt: string | null; deletedAt: string | null;
};

type LicenseRow = {
  email: string;
  status: string;
  planId: string;
  maxDevices: number;
  devicesUsed: number;
  activationKeyPreview: string | null;
  isTrial: boolean;
  expiresAt: string | null;
  trialEndsAt: string | null;
  createdAt: string | null;
  lastSeenAt: string | null;
  deletedAt: string | null;
};

type Detail = {
  licence: {
    licenseId: string; email: string; userId: string | null; appUserId: string | null;
    status: string; planId: string; livePassActive: boolean; isTrial: boolean;
    maxDevices: number; expiresAt: string | null; trialEndsAt: string | null;
    createdAt: string | null; activationKey: string | null; activationKeyPreview: string | null;
    deletedAt: string | null;
  };
  devices: Array<{ signaturePreview: string; os: string; arch: string; activatedAt: string | null; lastSeenAt: string | null }>;
  attempts: Array<{ outcome: string; errorCode: string | null; httpStatus: number | null; devicePreview: string | null; createdAt: string | null }>;
};

const C = {
  ink: "#1a1614", ink2: "#5b5550", ink3: "#9a948e", line: "#e9e4dc", bg: "#f6f3ee",
  panel: "#ffffff", green: "#2d7a3e", greenBg: "#e7f3ea", red: "#c0392b", redBg: "#fbeae8",
  amber: "#b5821e", amberBg: "#fbf2df", blue: "#3b6cd9", orange: "#e07b3c",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}
function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function daysLeft(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return isNaN(t) ? null : Math.ceil((t - Date.now()) / 86_400_000);
}
// A device is "active" if it checked in (validate heartbeat) within this window.
const ONLINE_MS = 15 * 60 * 1000;
function isActive(iso: string | null): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return !isNaN(t) && Date.now() - t < ONLINE_MS;
}
function relative(iso: string | null): string {
  if (!iso) return "never";
  const t = new Date(iso).getTime();
  if (isNaN(t)) return "—";
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24); if (d < 30) return `${d}d ago`;
  return fmtDate(iso);
}

function Pill({ text, fg, bg }: { text: string; fg: string; bg: string }) {
  return <span style={{ fontSize: 11, fontWeight: 700, color: fg, background: bg, padding: "3px 9px", borderRadius: 999, textTransform: "capitalize", whiteSpace: "nowrap" }}>{text}</span>;
}
function statusPill(status: string) {
  const active = status === "active";
  return <Pill text={status} fg={active ? C.green : C.red} bg={active ? C.greenBg : C.redBg} />;
}
function planPill(planId: string, isTrial: boolean) {
  return isTrial ? <Pill text="Trial" fg={C.orange} bg={C.amberBg} /> : <Pill text={planId} fg={C.blue} bg="#eaf0fc" />;
}

export default function AdminPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [configured, setConfigured] = useState(true);
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ msg: string; ok: boolean } | null>(null);
  const [rows, setRows] = useState<LicenseRow[]>([]);
  const [masterOn, setMasterOn] = useState(false);
  const [q, setQ] = useState("");
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [view, setView] = useState<"users" | "coupons" | "waitlist">("users");
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [modal, setModal] = useState<ModalCfg>(null);

  const loadLicenses = useCallback(async () => {
    const r = await fetch("/api/v1/admin/licenses").then((x) => x.json()).catch(() => ({}));
    if (r.ok) { setRows(r.licenses || []); setMasterOn(Boolean(r.master_key_enabled)); }
  }, []);
  const loadSession = useCallback(async () => {
    const r = await fetch("/api/v1/admin/auth").then((x) => x.json()).catch(() => ({}));
    setConfigured(Boolean(r.configured));
    setAuthed(Boolean(r.authed));
    if (r.authed) loadLicenses();
  }, [loadLicenses]);
  useEffect(() => { loadSession(); }, [loadSession]);

  const openUser = useCallback(async (email: string) => {
    setSelected(email); setDetail(null); setDetailLoading(true); setMenuFor(null);
    const r = await fetch(`/api/v1/admin/user?email=${encodeURIComponent(email)}`).then((x) => x.json()).catch(() => ({}));
    setDetailLoading(false);
    if (r.ok) setDetail(r as Detail);
    else setNote({ msg: `${email}: ${r.error || "could not load"}`, ok: false });
  }, []);

  async function login() {
    setBusy("login"); setNote(null);
    const r = await fetch("/api/v1/admin/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "login", secret }) }).then((x) => x.json()).catch(() => ({}));
    setBusy(null);
    if (r.authed) { setSecret(""); setAuthed(true); loadLicenses(); } else setNote({ msg: "Wrong secret.", ok: false });
  }
  async function logout() {
    await fetch("/api/v1/admin/auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "logout" }) });
    setAuthed(false); setRows([]); setSelected(null); setDetail(null);
  }
  async function post(email: string, action: string, extra: Record<string, unknown> = {}) {
    setBusy(email + action); setNote(null); setMenuFor(null);
    const r = await fetch("/api/v1/admin/license", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, email, ...extra }) }).then((x) => x.json()).catch(() => ({}));
    setBusy(null);
    setNote({ msg: r.ok ? `${email}: ${action.replace(/_/g, " ")} ✓` : `${email}: ${r.error || r.message || "failed"}`, ok: !!r.ok });
    loadLicenses();
    if (selected === email) openUser(email);
  }
  // Destructive user actions hit /api/v1/admin/user (soft/hard delete, restore).
  async function postUser(email: string, action: "soft_delete" | "restore" | "hard_delete", confirm?: string) {
    setBusy(email + action); setNote(null); setMenuFor(null);
    const r = await fetch("/api/v1/admin/user", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, email, confirm }) }).then((x) => x.json()).catch(() => ({}));
    setBusy(null);
    const verb = action === "hard_delete" ? "permanently deleted" : action === "restore" ? "restored" : "soft-deleted";
    setNote({ msg: r.ok ? `${email}: ${verb} ✓${action === "hard_delete" ? " — email is free to reuse" : ""}` : `${email}: ${r.error || r.message || "failed"}`, ok: !!r.ok });
    if (action === "hard_delete" && r.ok) { setSelected(null); setDetail(null); }
    else if (selected === email) openUser(email);
    loadLicenses();
  }
  async function pwdAction(email: string, body: Record<string, unknown>, okMsg: string) {
    setBusy(email + String(body.action)); setNote(null); setMenuFor(null);
    const r = await fetch("/api/v1/admin/user", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, ...body }) }).then((x) => x.json()).catch(() => ({}));
    setBusy(null);
    setNote({ msg: r.ok ? `${email}: ${okMsg} ✓` : `${email}: ${r.error || r.message || "failed"}`, ok: !!r.ok });
    if (selected === email) openUser(email);
  }

  // ── Modal openers (replace window.confirm / prompt; show current state) ──
  function openModal(cfg: ModalCfg) { setMenuFor(null); setNote(null); setModal(cfg); }
  const subjOf = (r: LicenseRow): Subject => ({
    email: r.email, status: r.status, planId: r.planId, isTrial: r.isTrial,
    maxDevices: r.maxDevices, devicesUsed: r.devicesUsed, expiresAt: r.expiresAt,
    trialEndsAt: r.trialEndsAt, createdAt: r.createdAt, deletedAt: r.deletedAt,
  });
  const planText = (s: Subject) => (s.isTrial ? "Pro — trial" : s.planId);
  const expText = (iso: string | null) => { const dl = daysLeft(iso); return iso ? `${fmtDate(iso)}${dl != null ? (dl <= 0 ? " (expired)" : ` (${dl}d left)`) : ""}` : "—"; };
  const stateRows = (s: Subject): { label: string; value: ReactNode }[] => [
    { label: "User", value: s.email },
    { label: "Status", value: s.deletedAt ? "soft-deleted" : s.status },
    { label: "Plan", value: planText(s) },
    { label: "Devices", value: `${s.devicesUsed} / ${s.maxDevices}` },
    { label: "Joined", value: fmtDate(s.createdAt) },
  ];

  function openExtendTrial(s: Subject) {
    openModal({ title: "Extend trial", tone: "primary",
      context: [{ label: "User", value: s.email }, { label: "Plan", value: planText(s) }, { label: "Trial ends", value: expText(s.trialEndsAt) }],
      body: "Adds days to the trial. If it already ended, it renews from today.",
      input: { kind: "number", label: "Days to add", default: "14", placeholder: "14" },
      confirmText: "Extend trial", onConfirm: (v) => { const n = parseInt(v, 10); if (n) post(s.email, "extend_trial", { days: n }); } });
  }
  function openExtendExpiry(s: Subject) {
    openModal({ title: "Extend paid expiry", tone: "primary",
      context: [{ label: "User", value: s.email }, { label: "Plan", value: planText(s) }, { label: "Paid expiry", value: expText(s.expiresAt) }],
      body: "Adds days to the paid licence expiry (renews from today if already expired).",
      input: { kind: "number", label: "Days to add", default: "365", placeholder: "365" },
      confirmText: "Extend expiry", onConfirm: (v) => { const n = parseInt(v, 10); if (n) post(s.email, "extend_expiry", { days: n }); } });
  }
  function openSetSeats(s: Subject) {
    openModal({ title: "Set device seats", tone: "primary",
      context: [{ label: "User", value: s.email }, { label: "Current limit", value: String(s.maxDevices) }, { label: "In use", value: `${s.devicesUsed} device(s)` }],
      body: "Changes how many devices this licence can activate at once.",
      input: { kind: "number", label: "New device-seat limit", default: String(s.maxDevices || 1), placeholder: "2" },
      confirmText: "Update seats", onConfirm: (v) => { const n = parseInt(v, 10); if (n) post(s.email, "set_max_devices", { max_devices: n }); } });
  }
  function openResetDevices(s: Subject) {
    openModal({ title: "Reset devices", tone: "danger",
      context: [{ label: "User", value: s.email }, { label: "Active devices", value: `${s.devicesUsed} / ${s.maxDevices}` }],
      body: "Clears ALL activated devices, freeing every seat. The user must re-activate OpenReply on each device.",
      confirmText: "Reset devices", onConfirm: () => post(s.email, "reset_devices") });
  }
  function openDisable(s: Subject) {
    openModal({ title: "Disable licence (revoke)", tone: "danger",
      context: stateRows(s),
      body: "Revokes the licence — the desktop app locks on its next validate. Reversible: re-enable anytime.",
      confirmText: "Disable licence", onConfirm: () => post(s.email, "revoke") });
  }
  function openExpire(s: Subject) {
    openModal({ title: "Expire now", tone: "danger",
      context: [{ label: "User", value: s.email }, { label: "Plan", value: planText(s) }, { label: "Current expiry", value: expText(s.isTrial ? s.trialEndsAt : s.expiresAt) }],
      body: "Sets the licence to expired as of now — the desktop app locks on its next check.",
      confirmText: "Expire now", onConfirm: () => post(s.email, "expire") });
  }
  function openSoftDelete(s: Subject) {
    openModal({ title: "Soft delete", tone: "danger",
      context: stateRows(s),
      body: "Disables the licence, frees device seats, and blocks website login. All data is kept — you can Restore later. Does NOT free the email for re-signup.",
      confirmText: "Soft delete", onConfirm: () => postUser(s.email, "soft_delete") });
  }
  function openHardDelete(s: Subject) {
    openModal({ title: "Delete permanently", tone: "danger",
      context: stateRows(s),
      body: "Erases the account, licence, devices, workspaces, and ALL data — and frees the email so it can sign up + activate again. This cannot be undone.",
      input: { kind: "text", label: "Type the email to confirm", placeholder: s.email },
      requireMatch: s.email, confirmText: "Delete permanently",
      onConfirm: (v) => postUser(s.email, "hard_delete", v.trim()) });
  }
  function openSendReset(s: Subject) {
    openModal({ title: "Send password-reset email", tone: "primary",
      context: [{ label: "User", value: s.email }, { label: "Status", value: s.deletedAt ? "soft-deleted" : s.status }],
      body: "Emails a 6-digit reset code. The user enters it on the Forgot-password screen to set a new password.",
      confirmText: "Send reset email", onConfirm: () => pwdAction(s.email, { action: "send_reset" }, "reset code emailed") });
  }
  function openSetPassword(s: Subject) {
    openModal({ title: "Set password", tone: "primary",
      context: [{ label: "User", value: s.email }, { label: "Status", value: s.deletedAt ? "soft-deleted" : s.status }],
      body: "Sets a new password immediately. Share it with the user — they can change it later from Forgot password.",
      input: { kind: "password", label: "New password", placeholder: "••••••••", hint: "Minimum 8 characters", minLen: 8 },
      confirmText: "Set password", onConfirm: (v) => pwdAction(s.email, { action: "set_password", new_password: v }, "password updated") });
  }
  function copyText(text: string, label: string) {
    navigator.clipboard.writeText(text).catch(() => {});
    setNote({ msg: `Copied ${label.toLowerCase()} ✓`, ok: true });
    window.setTimeout(() => setNote((n) => (n && n.msg.startsWith("Copied") ? null : n)), 1800);
  }

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    return n ? rows.filter((r) => r.email.toLowerCase().includes(n)) : rows;
  }, [rows, q]);
  const stats = useMemo(() => {
    let active = 0, trials = 0, expiring = 0, inactive = 0;
    for (const r of rows) {
      if (r.status === "active") active++; else inactive++;
      if (r.isTrial) trials++;
      const dl = daysLeft(r.isTrial ? r.trialEndsAt : r.expiresAt);
      if (r.status === "active" && dl != null && dl >= 0 && dl <= 7) expiring++;
    }
    return { total: rows.length, active, trials, expiring, inactive };
  }, [rows]);

  if (authed === null) return <main style={{ padding: 48, fontFamily: "system-ui", color: C.ink3 }}>Loading…</main>;
  if (!configured) {
    return <main style={{ maxWidth: 520, margin: "60px auto", fontFamily: "system-ui", color: C.ink, padding: "0 20px" }}><h1>Licence admin</h1><p style={{ color: C.red }}>Set <code>ADMIN_SECRET</code> in the server env to enable admin.</p></main>;
  }
  if (!authed) {
    return (
      <main style={{ minHeight: "100vh", background: C.bg, fontFamily: "system-ui", display: "grid", placeItems: "center", padding: 20 }}>
        <div style={{ width: "100%", maxWidth: 380, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 16, padding: 28, boxShadow: "0 8px 30px rgba(0,0,0,.06)" }}>
          <h1 style={{ fontSize: 22, margin: "0 0 4px", color: C.ink }}>Licence admin</h1>
          <p style={{ color: C.ink3, fontSize: 13, margin: "0 0 18px" }}>Enter the owner secret to continue.</p>
          <input type="password" value={secret} placeholder="ADMIN_SECRET" autoFocus
            style={{ width: "100%", padding: "11px 13px", border: `1px solid ${C.line}`, borderRadius: 10, fontSize: 14, marginBottom: 12, boxSizing: "border-box" }}
            onChange={(e) => setSecret(e.target.value)} onKeyDown={(e) => e.key === "Enter" && login()} />
          <button onClick={login} disabled={busy === "login"} style={{ width: "100%", padding: "11px", borderRadius: 10, border: "none", background: C.ink, color: "#fff", fontWeight: 700, fontSize: 14, cursor: "pointer" }}>{busy === "login" ? "Signing in…" : "Sign in"}</button>
          {note ? <p style={{ color: C.red, marginTop: 12, fontSize: 13 }}>{note.msg}</p> : null}
        </div>
      </main>
    );
  }

  // ── Detail view ──────────────────────────────────────────────────────────
  if (selected) {
    const d = detail?.licence;
    const dSubj: Subject | null = d ? {
      email: d.email, status: d.status, planId: d.planId, isTrial: d.isTrial,
      maxDevices: d.maxDevices, devicesUsed: detail?.devices.length ?? 0,
      expiresAt: d.expiresAt, trialEndsAt: d.trialEndsAt, createdAt: d.createdAt, deletedAt: d.deletedAt,
    } : null;
    const dateIso = d ? (d.isTrial ? d.trialEndsAt : d.expiresAt) : null;
    const dl = daysLeft(dateIso);
    const actBtn = (label: string, fn: () => void, kind: "primary" | "danger" | "ghost" = "ghost") => (
      <button onClick={fn} disabled={!!busy && busy.startsWith(selected)} style={{
        padding: "8px 13px", borderRadius: 9, fontWeight: 600, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap",
        border: kind === "ghost" ? `1px solid ${C.line}` : "none",
        background: kind === "primary" ? C.ink : kind === "danger" ? C.red : C.panel,
        color: kind === "ghost" ? C.ink : "#fff",
      }}>{label}</button>
    );
    return (
      <main style={{ minHeight: "100vh", background: C.bg, fontFamily: "system-ui", color: C.ink }}>
        <div style={{ maxWidth: 1000, margin: "0 auto", padding: "24px 24px 60px" }}>
          <button onClick={() => { setSelected(null); setDetail(null); }} style={{ background: "none", border: "none", color: C.ink2, fontSize: 14, cursor: "pointer", padding: "6px 0", marginBottom: 12 }}>← Back to all users</button>
          {note ? <div style={{ fontSize: 13, marginBottom: 14, padding: "8px 12px", borderRadius: 8, background: note.ok ? C.greenBg : C.redBg, color: note.ok ? C.green : C.red }}>{note.msg}</div> : null}

          {detailLoading || !d ? (
            <p style={{ color: C.ink3 }}>{detailLoading ? "Loading user…" : "User not found."}</p>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
                <h1 style={{ fontSize: 24, margin: 0, fontWeight: 800 }}>{d.email}</h1>
                {statusPill(d.status)} {planPill(d.planId, d.isTrial)}
                {d.livePassActive ? <Pill text="Live Pass" fg={C.green} bg={C.greenBg} /> : null}
              </div>
              <p style={{ color: C.ink3, fontSize: 13, margin: "0 0 18px" }}>
                Joined {fmtDate(d.createdAt)} · {detail!.devices.length} / {d.maxDevices} device(s)
                {(() => { const on = detail!.devices.filter((dv) => isActive(dv.lastSeenAt)).length; return on > 0 ? <> · <span style={{ color: C.green, fontWeight: 700 }}>🟢 {on} active now</span></> : null; })()}
              </p>

              {/* Actions */}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 22 }}>
                {d.status === "active"
                  ? actBtn("Disable (revoke)", () => openDisable(dSubj!), "danger")
                  : actBtn("Enable (reactivate)", () => post(d.email, "reactivate"), "primary")}
                {actBtn("Extend trial…", () => openExtendTrial(dSubj!))}
                {actBtn("Extend paid expiry…", () => openExtendExpiry(dSubj!))}
                {actBtn("Set device seats…", () => openSetSeats(dSubj!))}
                {actBtn("Reset devices", () => openResetDevices(dSubj!))}
                {actBtn("Expire now", () => openExpire(dSubj!), "danger")}
                <span style={{ width: 1, alignSelf: "stretch", background: C.line, margin: "0 2px" }} />
                {actBtn("Send reset email", () => openSendReset(dSubj!))}
                {actBtn("Set password…", () => openSetPassword(dSubj!))}
                <span style={{ width: 1, alignSelf: "stretch", background: C.line, margin: "0 2px" }} />
                {d.deletedAt
                  ? actBtn("♻ Restore user", () => postUser(d.email, "restore"), "primary")
                  : actBtn("Soft delete", () => openSoftDelete(dSubj!), "danger")}
                {actBtn("🗑 Delete permanently", () => openHardDelete(dSubj!), "danger")}
              </div>
              {d.deletedAt ? <div style={{ fontSize: 12.5, marginTop: -14, marginBottom: 18, color: C.amber }}>⚠ Soft-deleted {fmtDate(d.deletedAt)} — login blocked & licence disabled. Use Restore to re-enable, or Delete permanently to free the email.</div> : null}

              {/* Licence facts */}
              <Section title="Licence">
                <Facts items={[
                  ["Status", d.status],
                  ["Plan", d.planId + (d.isTrial ? " (trial)" : "")],
                  ["Live Pass", d.livePassActive ? "yes" : "no"],
                  [d.isTrial ? "Trial ends" : "Expires", dateIso ? `${fmtDate(dateIso)}${dl != null ? ` · ${dl <= 0 ? "expired" : `${dl}d left`}` : ""}` : "perpetual"],
                  ["Device seats", `${detail!.devices.length} / ${d.maxDevices}`],
                  ["Licence key", d.activationKey || "— (not stored for this licence)"],
                  ["Licence ID", d.licenseId],
                  ["Supabase user", d.userId || "—"],
                  ["App user", d.appUserId || "—"],
                  ["Created", fmtDateTime(d.createdAt)],
                ]} onCopy={copyText} />
              </Section>

              {/* Devices */}
              <Section title={`Activated devices (${detail!.devices.length})`}>
                {detail!.devices.length === 0 ? <Empty text="No devices activated." /> : (
                  <MiniTable head={["Device", "Fingerprint", "Activated", "Last seen"]} rows={detail!.devices.map((dv) => [
                    `${dv.os} · ${dv.arch}`, `${dv.signaturePreview}…`, fmtDateTime(dv.activatedAt), `${isActive(dv.lastSeenAt) ? "🟢 " : ""}${relative(dv.lastSeenAt)}`,
                  ])} />
                )}
              </Section>

              {/* Activation history */}
              <Section title={`Activation history (${detail!.attempts.length})`}>
                {detail!.attempts.length === 0 ? <Empty text="No recorded attempts." /> : (
                  <MiniTable head={["When", "Outcome", "Code", "HTTP", "Device"]} rows={detail!.attempts.map((a) => [
                    fmtDateTime(a.createdAt),
                    a.outcome,
                    a.errorCode || "—",
                    a.httpStatus != null ? String(a.httpStatus) : "—",
                    a.devicePreview ? `${a.devicePreview}…` : "—",
                  ])} colorFirstByOutcome />
                )}
              </Section>
            </>
          )}
        </div>
        <AdminModal cfg={modal} busy={!!busy} onClose={() => setModal(null)} />
      </main>
    );
  }

  // ── List view ────────────────────────────────────────────────────────────
  const statCard = (label: string, value: number, color: string) => (
    <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: "12px 16px", minWidth: 110 }}>
      <div style={{ fontSize: 22, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 12, color: C.ink3, marginTop: 4 }}>{label}</div>
    </div>
  );
  const mItem = (text: string, fn: () => void, danger = false) => (
    <button onClick={fn} style={{ display: "block", width: "100%", textAlign: "left", padding: "9px 14px", border: "none", background: "transparent", color: danger ? C.red : C.ink, fontSize: 13, cursor: "pointer", fontWeight: 500 }}
      onMouseEnter={(e) => (e.currentTarget.style.background = C.bg)} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>{text}</button>
  );

  return (
    <main style={{ minHeight: "100vh", background: C.bg, fontFamily: "system-ui", color: C.ink }}>
      <div style={{ maxWidth: 1240, margin: "0 auto", padding: "28px 24px 60px" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, marginBottom: 18, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ fontSize: 26, margin: 0, fontWeight: 800 }}>Licence admin</h1>
            <p style={{ color: C.ink3, fontSize: 13, margin: "4px 0 0" }}>
              Click a user for full detail. Master key:{" "}
              <strong style={{ color: masterOn ? C.green : C.red }}>{masterOn ? "ENABLED" : "off"}</strong>
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={loadLicenses} style={{ padding: "8px 14px", borderRadius: 9, border: `1px solid ${C.line}`, background: C.panel, color: C.ink, fontWeight: 600, fontSize: 13, cursor: "pointer" }}>↻ Refresh</button>
            <button onClick={logout} style={{ padding: "8px 14px", borderRadius: 9, border: `1px solid ${C.line}`, background: C.panel, color: C.ink2, fontWeight: 600, fontSize: 13, cursor: "pointer" }}>Log out</button>
          </div>
        </header>

        <div style={{ display: "flex", gap: 4, marginBottom: 18, borderBottom: `1px solid ${C.line}` }}>
          {([["users", "Users"], ["coupons", "Coupons / codes"], ["waitlist", "Waitlist"]] as const).map(([k, label]) => (
            <button key={k} onClick={() => { setView(k); setSelected(null); }} style={{
              padding: "9px 16px", border: "none", background: "none", cursor: "pointer",
              fontSize: 13.5, fontWeight: 700, color: view === k ? C.ink : C.ink3,
              borderBottom: `2px solid ${view === k ? C.orange : "transparent"}`, marginBottom: -1,
            }}>{label}</button>
          ))}
        </div>

        {view === "coupons" ? <CouponsSection /> : view === "waitlist" ? <WaitlistSection /> : (
        <>
        <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
          {statCard("Total users", stats.total, C.ink)}
          {statCard("Active", stats.active, C.green)}
          {statCard("On trial", stats.trials, C.orange)}
          {statCard("Expiring ≤7d", stats.expiring, C.amber)}
          {statCard("Disabled / expired", stats.inactive, C.red)}
        </div>

        <input value={q} placeholder="Search by email…" style={{ width: "100%", maxWidth: 380, padding: "10px 13px", border: `1px solid ${C.line}`, borderRadius: 10, fontSize: 14, marginBottom: 12, boxSizing: "border-box" }} onChange={(e) => setQ(e.target.value)} />
        {note ? <div style={{ fontSize: 13, marginBottom: 12, padding: "8px 12px", borderRadius: 8, background: note.ok ? C.greenBg : C.redBg, color: note.ok ? C.green : C.red }}>{note.msg}</div> : null}

        <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14 }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: "left", color: C.ink3 }}>
                  {["User", "Plan", "Status", "Devices", "Expiry", "Last seen", "Key", ""].map((h, i) => (
                    <th key={i} style={{ padding: "12px 14px", fontWeight: 600, fontSize: 11.5, textTransform: "uppercase", letterSpacing: ".04em", borderBottom: `1px solid ${C.line}`, whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={8} style={{ padding: 30, textAlign: "center", color: C.ink3 }}>{rows.length ? "No matches." : "No licences yet."}</td></tr>
                ) : filtered.map((r, idx) => {
                  const dateIso = r.isTrial ? r.trialEndsAt : r.expiresAt;
                  const dl = daysLeft(dateIso);
                  const expFg = dl != null && dl <= 0 ? C.red : dl != null && dl <= 7 ? C.amber : C.ink2;
                  const open = menuFor === r.email;
                  return (
                    <tr key={r.email + (r.activationKeyPreview || "")} style={{ background: idx % 2 ? "#fcfbf9" : C.panel }}>
                      <td style={{ padding: "11px 14px", borderBottom: `1px solid ${C.line}` }}>
                        <button onClick={() => openUser(r.email)} style={{ background: "none", border: "none", padding: 0, textAlign: "left", cursor: "pointer", fontWeight: 600, color: r.deletedAt ? C.ink3 : C.blue, fontSize: 13, textDecoration: r.deletedAt ? "line-through" : "none" }}>{r.email}</button>
                        {r.deletedAt ? <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 700, color: C.amber, background: C.amberBg, padding: "1px 6px", borderRadius: 6 }}>SOFT-DELETED</span> : null}
                        <div style={{ color: C.ink3, fontSize: 11.5, marginTop: 1 }}>joined {fmtDate(r.createdAt)}</div>
                      </td>
                      <td style={{ padding: "11px 14px", borderBottom: `1px solid ${C.line}`, whiteSpace: "nowrap" }}>{planPill(r.planId, r.isTrial)}</td>
                      <td style={{ padding: "11px 14px", borderBottom: `1px solid ${C.line}` }}>{statusPill(r.status)}</td>
                      <td style={{ padding: "11px 14px", borderBottom: `1px solid ${C.line}`, color: r.devicesUsed >= r.maxDevices ? C.amber : C.ink2, whiteSpace: "nowrap" }}>{r.devicesUsed}/{r.maxDevices}</td>
                      <td style={{ padding: "11px 14px", borderBottom: `1px solid ${C.line}`, color: expFg, whiteSpace: "nowrap" }}>
                        {dateIso ? <>{fmtDate(dateIso)} <span style={{ color: C.ink3 }}>· {dl != null && dl <= 0 ? "expired" : `${dl}d`}</span></> : <span style={{ color: C.ink3 }}>perpetual</span>}
                      </td>
                      <td style={{ padding: "11px 14px", borderBottom: `1px solid ${C.line}`, color: isActive(r.lastSeenAt) ? C.green : C.ink2, whiteSpace: "nowrap", fontWeight: isActive(r.lastSeenAt) ? 700 : 400 }}>{isActive(r.lastSeenAt) ? "🟢 active" : relative(r.lastSeenAt)}</td>
                      <td style={{ padding: "11px 14px", borderBottom: `1px solid ${C.line}`, fontFamily: "ui-monospace, monospace", color: C.ink3 }}>…{r.activationKeyPreview || "????"}</td>
                      <td style={{ padding: "8px 14px", borderBottom: `1px solid ${C.line}`, position: "relative", textAlign: "right" }}>
                        <button onClick={() => setMenuFor(open ? null : r.email)} disabled={!!busy && busy.startsWith(r.email)}
                          style={{ padding: "6px 12px", borderRadius: 8, border: `1px solid ${C.line}`, background: open ? C.bg : C.panel, color: C.ink, fontWeight: 600, fontSize: 12.5, cursor: "pointer", whiteSpace: "nowrap" }}>Manage ▾</button>
                        {open ? (
                          <>
                            <div onClick={() => setMenuFor(null)} style={{ position: "fixed", inset: 0, zIndex: 10 }} />
                            <div style={{ position: "absolute", right: 14, top: "100%", marginTop: 4, zIndex: 20, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10, boxShadow: "0 10px 30px rgba(0,0,0,.12)", minWidth: 200, padding: "5px 0", textAlign: "left" }}>
                              {mItem("View details →", () => openUser(r.email))}
                              <div style={{ height: 1, background: C.line, margin: "5px 0" }} />
                              {r.status === "active"
                                ? mItem("Disable (revoke)", () => openDisable(subjOf(r)), true)
                                : mItem("Enable (reactivate)", () => post(r.email, "reactivate"))}
                              {mItem("Extend trial…", () => openExtendTrial(subjOf(r)))}
                              {mItem("Extend paid expiry…", () => openExtendExpiry(subjOf(r)))}
                              {mItem("Set device seats…", () => openSetSeats(subjOf(r)))}
                              {mItem("Reset devices", () => openResetDevices(subjOf(r)))}
                              {mItem("Expire now", () => openExpire(subjOf(r)), true)}
                              <div style={{ height: 1, background: C.line, margin: "5px 0" }} />
                              {mItem("Send reset email", () => openSendReset(subjOf(r)))}
                              {mItem("Set password…", () => openSetPassword(subjOf(r)))}
                              <div style={{ height: 1, background: C.line, margin: "5px 0" }} />
                              {r.deletedAt
                                ? mItem("♻ Restore user", () => postUser(r.email, "restore"))
                                : mItem("Soft delete", () => openSoftDelete(subjOf(r)), true)}
                              {mItem("🗑 Delete permanently", () => openHardDelete(subjOf(r)), true)}
                            </div>
                          </>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        </>
        )}
      </div>
      <AdminModal cfg={modal} busy={!!busy} onClose={() => setModal(null)} />
    </main>
  );
}

// ── Detail-view building blocks ──────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, padding: "16px 18px", marginBottom: 16 }}>
      <h2 style={{ fontSize: 14, margin: "0 0 12px", fontWeight: 700, color: C.ink2, textTransform: "uppercase", letterSpacing: ".04em" }}>{title}</h2>
      {children}
    </section>
  );
}
function Facts({ items, onCopy }: { items: Array<[string, string]>; onCopy?: (v: string, label: string) => void }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "12px 24px" }}>
      {items.map(([k, v], i) => {
        const copyable = !!onCopy && !!v && !v.startsWith("—") && v !== "perpetual" && v !== "no" && v !== "yes";
        return (
          <div key={i}>
            <div style={{ fontSize: 11.5, color: C.ink3, marginBottom: 2 }}>{k}</div>
            <div
              onClick={copyable ? () => onCopy!(v, k) : undefined}
              title={copyable ? "Click to copy" : undefined}
              style={{ fontSize: 13.5, fontWeight: 600, wordBreak: "break-all", cursor: copyable ? "pointer" : "default", display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              {v}
              {copyable ? <span style={{ color: C.ink3, fontWeight: 400, fontSize: 12 }}>⧉</span> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
function MiniTable({ head, rows, colorFirstByOutcome }: { head: string[]; rows: string[][]; colorFirstByOutcome?: boolean }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
        <thead>
          <tr style={{ textAlign: "left", color: C.ink3 }}>
            {head.map((h, i) => <th key={i} style={{ padding: "8px 10px", fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: ".03em", borderBottom: `1px solid ${C.line}`, whiteSpace: "nowrap" }}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => {
                const ok = colorFirstByOutcome && j === 1 && /ok|success|activated/i.test(c);
                const bad = colorFirstByOutcome && j === 1 && /fail|error|denied|revoked|invalid/i.test(c);
                return <td key={j} style={{ padding: "8px 10px", borderBottom: `1px solid ${C.line}`, whiteSpace: "nowrap", fontFamily: j > 0 && /^[a-f0-9]/.test(c) ? "ui-monospace, monospace" : undefined, color: ok ? C.green : bad ? C.red : C.ink2 }}>{c}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return <p style={{ color: C.ink3, fontSize: 13, margin: 0 }}>{text}</p>;
}
