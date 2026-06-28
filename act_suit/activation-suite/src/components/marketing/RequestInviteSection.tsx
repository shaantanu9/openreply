"use client";

import { useEffect, useRef, useState } from "react";

const INVITE_FLAG = "openreply_invite_requested";

// Homepage invite-request capture. Hits /api/v1/invite/request (auto-invite
// while seats remain, else waitlist). Remembers the request in localStorage so
// returning visitors see "already requested" instead of the form.
export function RequestInviteSection() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<null | { sent: boolean; email: string; cached?: boolean }>(null);
  const [error, setError] = useState<string | null>(null);
  const lastSubmit = useRef(0);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(INVITE_FLAG);
      if (raw) { const v = JSON.parse(raw) as { email: string; sent: boolean }; if (v?.email) setDone({ sent: !!v.sent, email: v.email, cached: true }); }
    } catch { /* ignore */ }
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = email.trim();
    if (!value) { setError("Enter your email to request an invite."); return; }
    const now = Date.now();
    if (busy || now - lastSubmit.current < 2500) return;
    lastSubmit.current = now;
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/v1/invite/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: value, name: name.trim(), reason: reason.trim() }),
      }).then((x) => x.json());
      if (res?.error === "rate_limited") { setError("You're going a bit fast — give it a minute and try again."); return; }
      if (!res?.ok) throw new Error(res?.error === "invalid_email" ? "That email doesn't look right." : (res?.error || "Couldn't request an invite."));
      const sent = !!res.sent || !!res.alreadyRequested;
      setDone({ sent, email: value });
      try { localStorage.setItem(INVITE_FLAG, JSON.stringify({ email: value, sent })); } catch { /* ignore */ }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="request-invite" className="bg-[var(--cream)] px-8 py-[100px]">
      <div className="mx-auto max-w-[640px] text-center">
        <span className="section-label">🔒 Invite-only beta</span>
        <h2 className="mt-2 font-serif text-[clamp(32px,4.2vw,48px)] font-normal leading-[1.1] tracking-[-1.2px] text-[var(--dark)]">
          Request your <em className="italic text-[var(--orange)]">founding invite</em>
        </h2>
        <p className="mx-auto mt-4 max-w-[480px] text-[16px] leading-[1.7] text-[var(--muted)]">
          OpenReply is invite-only while in beta — seats are limited. Drop your email
          and we&rsquo;ll send a founding-member code as seats open. First in line,
          first invited.
        </p>

        {done ? (
          <div className="mx-auto mt-9 max-w-[460px] rounded-[18px] border border-[var(--border-strong)] bg-white p-8">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--orange-pale)] text-[26px]">{done.sent ? "🎟️" : "⏳"}</div>
            <h3 className="text-[20px] font-semibold text-[var(--dark)]">{done.cached ? "You've already requested your invite" : done.sent ? "You're in — check your inbox" : "You're on the list"}</h3>
            <p className="mt-2 text-[14px] leading-[1.6] text-[var(--muted)]">
              {done.cached ? (
                <>We sent your founding invite to <strong className="text-[var(--dark)]">{done.email}</strong>. Check your inbox for the code, then sign up to claim your licence key.</>
              ) : done.sent ? (
                <>We emailed <strong className="text-[var(--dark)]">{done.email}</strong> your founding-member invite code. Use it to sign up and claim your licence key.</>
              ) : (
                <>Founding seats are full right now — we&rsquo;ll email <strong className="text-[var(--dark)]">{done.email}</strong> an invite the moment one opens.</>
              )}
            </p>
            {done.sent ? <a href="/sign-in" className="btn btn-orange mt-5 inline-flex justify-center">Got my code? Sign up →</a> : null}
          </div>
        ) : (
          <form onSubmit={submit} className="mx-auto mt-9 max-w-[460px] rounded-[18px] border border-[var(--border-strong)] bg-white p-6 text-left">
            <div className="mb-3 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-[12.5px] font-medium text-[var(--text)]">Email</label>
                <input
                  type="email" autoComplete="email" placeholder="you@company.com" value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-[10px] border border-[var(--border-strong)] bg-white px-[13px] py-[10px] text-[14px] text-[var(--text)] outline-none transition-shadow focus:border-[var(--orange)] focus:shadow-[0_0_0_3px_rgba(224,123,60,0.12)]"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-[12.5px] font-medium text-[var(--text)]">Name <span className="text-[var(--muted-light)]">(optional)</span></label>
                <input
                  type="text" autoComplete="name" placeholder="Rahul Sharma" value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-[10px] border border-[var(--border-strong)] bg-white px-[13px] py-[10px] text-[14px] text-[var(--text)] outline-none transition-shadow focus:border-[var(--orange)] focus:shadow-[0_0_0_3px_rgba(224,123,60,0.12)]"
                />
              </div>
            </div>
            <div className="mb-4">
              <label className="mb-1.5 block text-[12.5px] font-medium text-[var(--text)]">What do you want to use OpenReply for? <span className="text-[var(--muted-light)]">(optional)</span></label>
              <textarea
                rows={2} placeholder="e.g. finding gaps in the note-taking market…" value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full resize-none rounded-[10px] border border-[var(--border-strong)] bg-white px-[13px] py-[10px] text-[14px] text-[var(--text)] outline-none transition-shadow focus:border-[var(--orange)] focus:shadow-[0_0_0_3px_rgba(224,123,60,0.12)]"
              />
            </div>
            {error ? <p className="mb-3 text-[13px] text-rose-600">{error}</p> : null}
            <button type="submit" disabled={busy} className="btn btn-orange w-full justify-center disabled:opacity-70">
              {busy ? "Requesting…" : "Request my invite →"}
            </button>
            <p className="mt-3 text-center text-[12.5px] text-[var(--muted)]">
              Already have a code? <a href="/sign-in" className="font-medium text-[var(--orange)] hover:underline">Claim it →</a>
            </p>
          </form>
        )}
      </div>
    </section>
  );
}
