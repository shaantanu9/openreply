"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

const C = {
  ink: "#1a1614", ink2: "#5b5550", ink3: "#9a948e", line: "#e9e4dc", bg: "#f6f3ee",
  panel: "#ffffff", green: "#2d7a3e", greenBg: "#e7f3ea", red: "#c0392b", redBg: "#fbeae8",
  amber: "#b5821e", amberBg: "#fbf2df", blue: "#3b6cd9", orange: "#e07b3c", orangeBg: "#fbf0e7",
};

type Coupon = {
  code: string; planId: string; maxRedemptions: number | null; currentRedemptions: number;
  seatsLeft: number | null; expiresAt: string | null; licenseMaxDevices: number;
  licenseDurationDays: number | null; disabled: boolean; note: string | null; createdAt: string | null;
};
type Redemption = { couponCode: string; email: string; redeemedAt: string | null };

function fmt(iso: string | null): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "2-digit" }); } catch { return iso; }
}

export function CouponsSection() {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [redemptions, setRedemptions] = useState<Redemption[]>([]);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState<{ msg: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // create form
  const [code, setCode] = useState("");
  const [plan, setPlan] = useState("pro");
  const [seats, setSeats] = useState("50");
  const [days, setDays] = useState("");
  const [devices, setDevices] = useState("2");
  const [cnote, setCnote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch("/api/v1/admin/coupons").then((x) => x.json()).catch(() => ({}));
    if (r?.ok) { setCoupons(r.coupons || []); setRedemptions(r.redemptions || []); }
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const redemptionsByCode = useMemo(() => {
    const m = new Map<string, number>();
    for (const x of redemptions) m.set(x.couponCode, (m.get(x.couponCode) || 0) + 1);
    return m;
  }, [redemptions]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy("create"); setNote(null);
    const r = await fetch("/api/v1/admin/coupons", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "create",
        code: code.trim() || undefined,
        plan_id: plan,
        max_redemptions: seats.trim() ? parseInt(seats, 10) : null,
        expires_in_days: days.trim() ? parseInt(days, 10) : null,
        license_max_devices: devices.trim() ? parseInt(devices, 10) : 2,
        note: cnote.trim() || null,
      }),
    }).then((x) => x.json()).catch(() => ({}));
    setBusy(null);
    if (r?.ok) {
      setNote({ msg: `Created ${r.coupon.code} ✓`, ok: true });
      setCode(""); setCnote("");
      load();
    } else {
      setNote({ msg: r?.error === "code_exists" ? "That code already exists." : `Failed: ${r?.error || "error"}`, ok: false });
    }
  }

  async function toggle(c: Coupon) {
    setBusy(c.code); setNote(null);
    const r = await fetch("/api/v1/admin/coupons", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: c.disabled ? "enable" : "disable", code: c.code }),
    }).then((x) => x.json()).catch(() => ({}));
    setBusy(null);
    setNote({ msg: r?.ok ? `${c.code}: ${c.disabled ? "enabled" : "disabled"} ✓` : `Failed`, ok: !!r?.ok });
    load();
  }

  const inp = { padding: "9px 11px", border: `1px solid ${C.line}`, borderRadius: 9, fontSize: 13, boxSizing: "border-box" as const, background: "#fff", color: C.ink };

  return (
    <div>
      {note ? <div style={{ fontSize: 13, marginBottom: 12, padding: "8px 12px", borderRadius: 8, background: note.ok ? C.greenBg : C.redBg, color: note.ok ? C.green : C.red }}>{note.msg}</div> : null}

      {/* Create */}
      <form onSubmit={create} style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, padding: 18, marginBottom: 18 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Create a coupon / invite code</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 12 }}>
          <label style={{ display: "grid", gap: 4, fontSize: 11.5, color: C.ink3, fontWeight: 600 }}>CODE (blank = auto)
            <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="GAPMAP-XXXX-XXXX" style={{ ...inp, fontFamily: "ui-monospace, monospace" }} /></label>
          <label style={{ display: "grid", gap: 4, fontSize: 11.5, color: C.ink3, fontWeight: 600 }}>PLAN
            <select value={plan} onChange={(e) => setPlan(e.target.value)} style={inp}>
              <option value="pro">pro</option><option value="pro_trial">pro_trial</option><option value="live_pass">live_pass</option><option value="free">free</option>
            </select></label>
          <label style={{ display: "grid", gap: 4, fontSize: 11.5, color: C.ink3, fontWeight: 600 }}>SEATS (blank = ∞)
            <input value={seats} onChange={(e) => setSeats(e.target.value)} placeholder="50" inputMode="numeric" style={inp} /></label>
          <label style={{ display: "grid", gap: 4, fontSize: 11.5, color: C.ink3, fontWeight: 600 }}>EXPIRES IN DAYS
            <input value={days} onChange={(e) => setDays(e.target.value)} placeholder="never" inputMode="numeric" style={inp} /></label>
          <label style={{ display: "grid", gap: 4, fontSize: 11.5, color: C.ink3, fontWeight: 600 }}>DEVICE SEATS
            <input value={devices} onChange={(e) => setDevices(e.target.value)} placeholder="2" inputMode="numeric" style={inp} /></label>
          <label style={{ display: "grid", gap: 4, fontSize: 11.5, color: C.ink3, fontWeight: 600 }}>NOTE
            <input value={cnote} onChange={(e) => setCnote(e.target.value)} placeholder="e.g. ProductHunt launch" style={inp} /></label>
        </div>
        <button type="submit" disabled={busy === "create"} style={{ padding: "9px 18px", borderRadius: 9, border: "none", background: C.orange, color: "#fff", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
          {busy === "create" ? "Creating…" : "+ Create code"}
        </button>
      </form>

      {/* List */}
      <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr style={{ textAlign: "left", color: C.ink3 }}>
              {["Code", "Plan", "Seats used", "Redeemed", "Expires", "Status", "Note", ""].map((h, i) => (
                <th key={i} style={{ padding: "12px 14px", fontWeight: 600, fontSize: 11.5, textTransform: "uppercase", letterSpacing: ".04em", borderBottom: `1px solid ${C.line}`, whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} style={{ padding: 28, textAlign: "center", color: C.ink3 }}>Loading…</td></tr>
              ) : coupons.length === 0 ? (
                <tr><td colSpan={8} style={{ padding: 28, textAlign: "center", color: C.ink3 }}>No coupons yet — create one above.</td></tr>
              ) : coupons.map((c, idx) => {
                const used = c.maxRedemptions == null ? `${c.currentRedemptions} / ∞` : `${c.currentRedemptions} / ${c.maxRedemptions}`;
                const full = c.maxRedemptions != null && c.currentRedemptions >= c.maxRedemptions;
                return (
                  <tr key={c.code} style={{ background: idx % 2 ? "#fcfbf9" : C.panel }}>
                    <td style={{ padding: "11px 14px", borderBottom: `1px solid ${C.line}`, fontFamily: "ui-monospace, monospace", fontWeight: 700 }}>
                      <button onClick={() => { navigator.clipboard?.writeText(c.code); setNote({ msg: `Copied ${c.code}`, ok: true }); }} title="Copy" style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: C.ink, fontFamily: "inherit", fontWeight: 700 }}>{c.code}</button>
                    </td>
                    <td style={{ padding: "11px 14px", borderBottom: `1px solid ${C.line}`, color: C.ink2 }}>{c.planId}</td>
                    <td style={{ padding: "11px 14px", borderBottom: `1px solid ${C.line}`, color: full ? C.amber : C.ink2, fontWeight: full ? 700 : 400, whiteSpace: "nowrap" }}>{used}{full ? " · full" : ""}</td>
                    <td style={{ padding: "11px 14px", borderBottom: `1px solid ${C.line}`, color: C.ink3 }}>{redemptionsByCode.get(c.code) || 0}</td>
                    <td style={{ padding: "11px 14px", borderBottom: `1px solid ${C.line}`, color: C.ink2, whiteSpace: "nowrap" }}>{c.expiresAt ? fmt(c.expiresAt) : "never"}</td>
                    <td style={{ padding: "11px 14px", borderBottom: `1px solid ${C.line}` }}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 6, background: c.disabled ? C.redBg : C.greenBg, color: c.disabled ? C.red : C.green }}>{c.disabled ? "disabled" : "active"}</span>
                    </td>
                    <td style={{ padding: "11px 14px", borderBottom: `1px solid ${C.line}`, color: C.ink3, fontSize: 12, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.note || "—"}</td>
                    <td style={{ padding: "8px 14px", borderBottom: `1px solid ${C.line}`, textAlign: "right" }}>
                      <button onClick={() => toggle(c)} disabled={busy === c.code} style={{ padding: "6px 11px", borderRadius: 8, border: `1px solid ${C.line}`, background: C.panel, color: c.disabled ? C.green : C.red, fontWeight: 600, fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}>
                        {busy === c.code ? "…" : c.disabled ? "Enable" : "Disable"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent redemptions */}
      <div style={{ marginTop: 18, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, padding: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>Recent redemptions ({redemptions.length})</div>
        {redemptions.length === 0 ? <div style={{ color: C.ink3, fontSize: 13 }}>None yet.</div> : (
          <div style={{ display: "grid", gap: 6 }}>
            {redemptions.slice(0, 30).map((x, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, color: C.ink2, borderBottom: `1px solid ${C.bg}`, paddingBottom: 5 }}>
                <span><span style={{ fontFamily: "ui-monospace, monospace", color: C.orange }}>{x.couponCode}</span> → {x.email}</span>
                <span style={{ color: C.ink3 }}>{fmt(x.redeemedAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
