"use client";

import { useEffect, useRef, useState } from "react";

const INVITE_FLAG = "openreply_invite_requested";

// Full-screen invite hero at the top of the homepage (above the slider).
// Mix of "Minimal Center" + "Social-Proof Stats". Submitting the email hits
// /api/v1/invite/request — auto-emails a single-use founding code while seats
// remain, otherwise joins the waitlist for admin approval. We remember the
// request in localStorage so returning visitors see "already requested".
export function InviteHero() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<null | { sent: boolean; resent?: boolean; cached?: boolean; email: string }>(null);
  const lastSubmit = useRef(0);

  // Returning visitor — read the saved flag (localStorage, not cookies).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(INVITE_FLAG);
      if (raw) {
        const v = JSON.parse(raw) as { email: string; sent: boolean };
        if (v?.email) setResult({ sent: !!v.sent, cached: true, email: v.email });
      }
    } catch { /* ignore */ }
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = email.trim();
    if (!value) { setError("Enter your email to request an invite."); return; }
    // Throttle: ignore rapid re-submits (double-click / spam).
    const now = Date.now();
    if (busy || now - lastSubmit.current < 2500) return;
    lastSubmit.current = now;
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/v1/invite/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: value }),
      }).then((x) => x.json());
      if (res?.error === "rate_limited") { setError("You're going a bit fast — give it a minute and try again."); return; }
      if (!res?.ok) throw new Error(res?.error === "invalid_email" ? "That email doesn't look right." : (res?.error || "Something went wrong."));
      const sent = !!res.sent || !!res.alreadyRequested;
      setResult({ sent, resent: !!res.resent, email: value });
      try { localStorage.setItem(INVITE_FLAG, JSON.stringify({ email: value, sent })); } catch { /* ignore */ }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      id="invite"
      className="flex items-center justify-center bg-[var(--cream)] px-6 py-16"
      style={{ minHeight: "calc(100vh - 61px)" }}
    >
      <div className="w-full max-w-[720px] text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-[rgba(224,123,60,0.3)] bg-[var(--orange-pale)] px-[14px] py-[6px] text-[12px] font-semibold uppercase tracking-[1px] text-[var(--orange)]">
          🔒 Invite-only beta · 100 founding seats
        </span>

        <h1 className="mt-7 font-serif text-[clamp(40px,6vw,62px)] font-normal leading-[1.06] tracking-[-1.4px] text-[var(--dark)]">
          Find the gaps before
          <br />
          your competitors do.
        </h1>

        <p className="mx-auto mt-[18px] max-w-[540px] text-[clamp(15px,2.4vw,18px)] leading-[1.6] text-[var(--ink2)]">
          Point OpenReply at Reddit, app reviews, HN and 10 more sources — get ranked
          pain points, DIY workarounds and market gaps in one sweep.
        </p>

        {/* Capture / success */}
        {result ? (
          <div className="mx-auto mt-8 max-w-[480px] rounded-[16px] border border-[var(--border-strong)] bg-white p-7">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--orange-pale)] text-[26px]">
              {result.sent ? "🎟️" : "⏳"}
            </div>
            <h3 className="text-[20px] font-semibold text-[var(--dark)]">
              {result.cached
                ? "You've already requested your invite"
                : result.sent ? (result.resent ? "Invite re-sent!" : "You're in — check your inbox") : "You're on the list"}
            </h3>
            <p className="mt-2 text-[14px] leading-[1.6] text-[var(--muted)]">
              {result.cached ? (
                <>We sent your founding invite to <strong className="text-[var(--dark)]">{result.email}</strong>. Check your inbox for the code, then sign up to claim your licence key.</>
              ) : result.sent ? (
                <>We just emailed <strong className="text-[var(--dark)]">{result.email}</strong> your founding-member invite code. Use it to sign up and claim your licence key.</>
              ) : (
                <>Founding seats are full right now — we&rsquo;ll email <strong className="text-[var(--dark)]">{result.email}</strong> an invite the moment one opens.</>
              )}
            </p>
            {result.sent ? (
              <a href="/sign-in" className="btn btn-orange mt-5 inline-flex justify-center">Got my code? Sign up →</a>
            ) : null}
          </div>
        ) : (
          <>
            <form onSubmit={submit} className="mx-auto mt-8 flex max-w-[560px] flex-col items-stretch justify-center gap-[10px] sm:flex-row sm:items-center">
              <input
                type="email" autoComplete="email" placeholder="you@company.com" value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full flex-1 rounded-[11px] border border-[var(--border-strong)] bg-white px-4 py-[14px] text-[15px] text-[var(--text)] outline-none transition-shadow focus:border-[var(--orange)] focus:shadow-[0_0_0_3px_rgba(224,123,60,0.12)] sm:w-auto sm:min-w-[260px]"
              />
              <button type="submit" disabled={busy} className="btn btn-orange justify-center px-7 py-[14px] disabled:opacity-70">
                {busy ? "Requesting…" : "Request invite →"}
              </button>
            </form>
            {error ? <p className="mt-3 text-[13px] text-rose-600">{error}</p> : null}
            <p className="mt-[13px] text-[12.5px] text-[var(--muted)]">
              We&rsquo;ll email your invite + licence key · no card · ~2 min to activate
            </p>
          </>
        )}

        {/* Social proof (from V5) */}
        <div className="mt-12 flex items-start justify-center gap-9">
          {[["40k", "posts / sweep"], ["13", "sources"], ["10x", "faster"]].map(([n, l]) => (
            <div key={l}>
              <div className="font-serif text-[30px] text-[var(--orange)]">{n}</div>
              <div className="text-[12.5px] text-[var(--muted)]">{l}</div>
            </div>
          ))}
        </div>
        <p className="mt-5 text-[15px] text-[var(--ink2)]">
          <span className="text-[var(--orange)]">★★★★★</span>&nbsp; “Cut two weeks of research synthesis to two days.” — Shreya R., Head of Product
        </p>
        <div className="mt-4 flex items-center justify-center gap-[9px] text-[13px] text-[var(--muted)]">
          <span className="inline-flex">
            {["#E07B3C", "#FF8C42", "#C98A5A", "#1A1614"].map((c, i) => (
              <span key={i} className="h-6 w-6 rounded-full border-2 border-[var(--cream)]" style={{ background: c, marginLeft: i ? -7 : 0 }} />
            ))}
          </span>
          +37 founders joined this week
        </div>
      </div>
    </section>
  );
}
