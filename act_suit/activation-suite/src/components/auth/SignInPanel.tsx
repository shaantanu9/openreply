"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { getSupabaseBrowserClient, hasPublicSupabaseConfig } from "@/lib/supabaseBrowser";
import { ROUTES } from "@/lib/constants";

// Honor ?next=... (used by /redeem → /sign-in → back to /redeem),
// but only for same-origin relative paths so an attacker can't link
// /sign-in?next=https://evil.example
function safeNext(raw: string | null): string | null {
  if (!raw) return null;
  // Single leading slash, no protocol, no doubled slash (network-path).
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  return raw;
}

type Tab = "login" | "register" | "forgot";
type Role = "product" | "research" | "agency" | "other";

const ROLE_OPTIONS: Array<{ value: Role; name: string; sub: string }> = [
  { value: "product", name: "Product work", sub: "PM / founder / strategy" },
  { value: "research", name: "Research", sub: "PhD / thesis / academia" },
  { value: "agency", name: "Agency / consulting", sub: "Client work / GTM" },
  { value: "other", name: "Other", sub: "Exploring" },
];

type Alert = { msg: string; type: "error" | "success" } | null;

function parseError(err: unknown): string {
  const fallback = "Something went wrong. Please try again.";
  const raw = err instanceof Error ? err.message : String(err || fallback);
  const normalized = raw.trim().toLowerCase();
  if (normalized.includes("invalid login credentials")) {
    return "Email or password is incorrect. Please try again.";
  }
  if (normalized.includes("email not confirmed")) {
    return "Please verify your email before signing in.";
  }
  return raw || fallback;
}

export function SignInPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = safeNext(searchParams?.get("next") ?? null);
  // Post-auth landing — honor ?next=, otherwise the dashboard (which now
  // surfaces the three "get a key" paths). Previously hard-coded /activate
  // which was the wrong destination for users who don't yet have a key.
  const postAuthDest = nextPath ?? ROUTES.dashboard;
  const [tab, setTab] = useState<Tab>("login");
  const [alert, setAlert] = useState<Alert>(null);
  const [envOk, setEnvOk] = useState(true);

  // form state
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPwd, setLoginPwd] = useState("");
  const [showLoginPwd, setShowLoginPwd] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);

  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [role, setRole] = useState<Role>("product");
  const [regPwd, setRegPwd] = useState("");
  const [showRegPwd, setShowRegPwd] = useState(false);
  const [regBusy, setRegBusy] = useState(false);

  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotBusy, setForgotBusy] = useState(false);

  useEffect(() => {
    setEnvOk(hasPublicSupabaseConfig());
  }, []);

  function switchTab(next: Tab) {
    setTab(next);
    setAlert(null);
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    // Email should be normalized, but password must be preserved exactly as
    // the user typed it (including whitespace) to match Supabase credentials.
    const email = loginEmail.trim();
    const password = loginPwd;
    if (!email || !password) {
      setAlert({ msg: "Please fill in all fields.", type: "error" });
      return;
    }
    setLoginBusy(true);
    try {
      const sb = getSupabaseBrowserClient();
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) {
        // Log the full Supabase error to the browser console so it's
        // inspectable via devtools if the on-screen message is ambiguous.
        // `error` has { name, status, message } — all useful context.
        // eslint-disable-next-line no-console
        console.error("[sign-in] supabase auth error:", error);
        throw error;
      }
      if (!data.session) {
        // Unexpected but possible — fall through to a retry instead of
        // silently claiming success. Usually means email-confirm is on and
        // the signup hasn't been confirmed yet.
        throw new Error(
          "Supabase returned no session. If email confirmation is enabled in your project, verify via the inbox first.",
        );
      }
      setAlert({ msg: "Signed in. Redirecting…", type: "success" });
      // Navigate with `replace` so the Back button doesn't take the user
      // to a stale sign-in page. Short delay just gives the user a beat to
      // see the success banner; shorter than before (was 900ms).
      setTimeout(() => {
        router.replace(postAuthDest);
        router.refresh();
      }, 250);
    } catch (err) {
      const msg = parseError(err);
      // eslint-disable-next-line no-console
      console.error("[sign-in] login failed:", err);
      setAlert({ msg, type: "error" });
    } finally {
      setLoginBusy(false);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (!first || !regEmail || !regPwd) {
      setAlert({ msg: "Please fill in all required fields.", type: "error" });
      return;
    }
    if (regPwd.length < 8) {
      setAlert({ msg: "Password must be at least 8 characters.", type: "error" });
      return;
    }
    setRegBusy(true);
    try {
      const sb = getSupabaseBrowserClient();
      const { error } = await sb.auth.signUp({
        email: regEmail.trim(),
        password: regPwd,
        options: {
          data: {
            first_name: first.trim(),
            last_name: last.trim(),
            full_name: [first, last].map((s) => s.trim()).filter(Boolean).join(" "),
            role,
          },
        },
      });
      if (error) throw error;
      setAlert({
        msg:
          "Account created. Next step: activate your key (or start trial) on the Activate page.",
        type: "success",
      });
      setTimeout(() => {
        router.push(postAuthDest);
        router.refresh();
      }, 1500);
    } catch (err) {
      setAlert({ msg: parseError(err), type: "error" });
    } finally {
      setRegBusy(false);
    }
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    if (!forgotEmail) {
      setAlert({ msg: "Please enter your email.", type: "error" });
      return;
    }
    setForgotBusy(true);
    try {
      const sb = getSupabaseBrowserClient();
      const { error } = await sb.auth.resetPasswordForEmail(forgotEmail.trim());
      if (error) throw error;
      setAlert({ msg: "Reset link sent! Check your inbox.", type: "success" });
    } catch (err) {
      setAlert({ msg: parseError(err), type: "error" });
    } finally {
      setForgotBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen grid-cols-1 md:grid-cols-2">
      {/* LEFT PANEL */}
      <div className="relative hidden overflow-hidden bg-[var(--dark)] p-12 md:flex md:flex-col md:justify-between">
        <div
          aria-hidden
          className="pointer-events-none absolute left-[-100px] top-[-100px] h-[400px] w-[400px] rounded-full border border-[rgba(224,123,60,0.12)]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute left-[-250px] top-[-250px] h-[700px] w-[700px] rounded-full border border-[rgba(224,123,60,0.08)]"
        />
        <Link href={ROUTES.home} className="relative z-10 inline-flex items-center gap-[10px]">
          <span className="flex h-[34px] w-[34px] items-center justify-center rounded-[8px] border border-white/15 bg-white/[0.08]">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
              <circle cx="9" cy="9" r="7" stroke="#E07B3C" strokeWidth="1.5" />
              <circle cx="9" cy="9" r="3" fill="#E07B3C" />
            </svg>
          </span>
          <span className="font-serif text-[18px] font-normal tracking-[-0.3px] text-white">
            Gap Map
          </span>
        </Link>
        <div className="relative z-10">
          <h2 className="font-serif text-[40px] font-normal leading-[1.15] tracking-[-1.2px] text-white">
            Research intelligence.
            <br />
            <em className="italic text-[var(--orange-light)]">Yours to keep.</em>
          </h2>
          <p className="mt-5 max-w-[340px] text-[15px] font-light leading-[1.7] text-white/45">
            The app runs fully local on your Mac. Your data never leaves your
            machine. Create your account first, then activate your licence key
            to unlock the full app.
          </p>
        </div>
        <div className="relative z-10 flex flex-col gap-3">
          {[
            ["BYOK", "your AI key, your inference costs"],
            ["Local-first", "SQLite on your machine, not our cloud"],
            ["Perpetual licence", "own the version you buy"],
            ["14-day Pro trial", "no credit card needed"],
          ].map(([strong, rest]) => (
            <div key={strong} className="flex items-center gap-3">
              <span className="h-[6px] w-[6px] shrink-0 rounded-full bg-[var(--orange)]" />
              <p className="text-[13px] text-white/45">
                <strong className="font-medium text-white/70">{strong}</strong> — {rest}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* RIGHT PANEL */}
      <div className="flex items-center justify-center bg-[var(--cream)] px-6 py-12 md:px-16">
        <div className="w-full max-w-[400px]">
          <p className="mb-5 text-center text-[13px] leading-[1.5] text-[var(--muted)]">
            <Link href={ROUTES.home} className="font-medium text-[var(--orange)]">
              Home
            </Link>
            <span className="mx-[10px] opacity-35">·</span>
            <Link href={ROUTES.activate} className="font-medium text-[var(--orange)]">
              Activate
            </Link>
            <span className="mx-[10px] opacity-35">·</span>
            <Link href={ROUTES.activationHelp} className="font-medium text-[var(--orange)]">
              Help
            </Link>
          </p>

          <div className="mb-8 flex border-b border-[var(--border)]">
            <button
              type="button"
              onClick={() => switchTab("login")}
              className={`-mb-px flex-1 border-b-2 py-3 text-[14px] font-medium transition-colors ${
                tab === "login"
                  ? "border-[var(--dark)] text-[var(--dark)]"
                  : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"
              }`}
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => switchTab("register")}
              className={`-mb-px flex-1 border-b-2 py-3 text-[14px] font-medium transition-colors ${
                tab === "register"
                  ? "border-[var(--dark)] text-[var(--dark)]"
                  : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"
              }`}
            >
              Create account
            </button>
          </div>

          {!envOk ? (
            <div
              role="status"
              className="mb-5 rounded-[10px] border border-[#F5C5C0] bg-[#FDF0EF] px-[14px] py-3 text-[13px] text-[var(--red)]"
            >
              Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in
              your env file, then restart the dev server.
            </div>
          ) : null}

          {alert ? (
            <div
              role="status"
              className={`mb-5 rounded-[10px] border px-[14px] py-3 text-[13.5px] ${
                alert.type === "success"
                  ? "border-[#9FE1CB] bg-[#EDF8F1] text-[#0F6E56]"
                  : "border-[#F5C5C0] bg-[#FDF0EF] text-[var(--red)]"
              }`}
            >
              {alert.msg}
            </div>
          ) : null}

          <div className="mb-5 rounded-[10px] border border-[var(--border)] bg-[var(--cream-mid)] px-[14px] py-3">
            <h4 className="mb-2 text-[12px] uppercase tracking-[0.08em] text-[var(--muted)]">
              Required flow
            </h4>
            <ol className="ml-5 grid list-decimal gap-[5px] text-[12.5px] text-[var(--text)]">
              <li>Create account (name, email, role).</li>
              <li>Buy or start trial, then get activation key.</li>
              <li>Open Activate page and enter key to use desktop app.</li>
            </ol>
            <p className="mt-2 text-[12px] text-[var(--muted)]">
              Need help? See{" "}
              <Link href={ROUTES.activationHelp} className="text-[var(--orange)]">
                Activation help
              </Link>
              .
            </p>
          </div>

          {tab === "login" ? (
            <form onSubmit={handleLogin} className="flex flex-col">
              <div className="mb-5">
                <label
                  htmlFor="loginEmail"
                  className="mb-2 block text-[13px] font-medium text-[var(--text)]"
                >
                  Email address
                </label>
                <input
                  id="loginEmail"
                  type="email"
                  autoComplete="email"
                  placeholder="you@company.com"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  className="w-full rounded-[10px] border border-[var(--border-strong)] bg-white px-[14px] py-[11px] text-[14px] text-[var(--text)] outline-none transition-shadow focus:border-[var(--orange)] focus:shadow-[0_0_0_3px_rgba(224,123,60,0.12)]"
                />
              </div>
              <div className="mb-5">
                <label
                  htmlFor="loginPwd"
                  className="mb-2 flex items-center justify-between text-[13px] font-medium text-[var(--text)]"
                >
                  Password
                  <button
                    type="button"
                    className="text-[12px] font-normal text-[var(--orange)] hover:underline"
                    onClick={() => switchTab("forgot")}
                  >
                    Forgot?
                  </button>
                </label>
                <div className="relative">
                  <input
                    id="loginPwd"
                    type={showLoginPwd ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="Your password"
                    value={loginPwd}
                    onChange={(e) => setLoginPwd(e.target.value)}
                    className="w-full rounded-[10px] border border-[var(--border-strong)] bg-white px-[14px] py-[11px] pr-14 text-[14px] text-[var(--text)] outline-none transition-shadow focus:border-[var(--orange)] focus:shadow-[0_0_0_3px_rgba(224,123,60,0.12)]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowLoginPwd((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] font-normal text-[var(--muted-light)] hover:text-[var(--muted)]"
                  >
                    {showLoginPwd ? "Hide" : "Show"}
                  </button>
                </div>
              </div>
              <button
                type="submit"
                disabled={loginBusy}
                className="flex w-full items-center justify-center gap-2 rounded-[10px] bg-[var(--dark)] px-4 py-3 text-[15px] font-medium text-white transition-all hover:-translate-y-px hover:bg-[var(--dark-mid)] disabled:pointer-events-none disabled:opacity-70"
              >
                {loginBusy ? "Signing in…" : "Sign in to Gap Map"}
              </button>
              <p className="mt-5 text-center text-[13px] text-[var(--muted)]">
                Don&rsquo;t have an account?{" "}
                <button
                  type="button"
                  onClick={() => switchTab("register")}
                  className="text-[var(--orange)] hover:underline"
                >
                  Create one free
                </button>
              </p>
            </form>
          ) : null}

          {tab === "register" ? (
            <form onSubmit={handleRegister} className="flex flex-col">
              <div className="mb-6 flex items-center gap-3 rounded-[10px] border border-[rgba(224,123,60,0.2)] bg-[var(--orange-pale)] px-[14px] py-3">
                <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--orange)]" />
                <p className="text-[13px] leading-[1.4] text-[var(--text)]">
                  <strong className="font-medium text-[var(--orange)]">
                    14-day Pro trial included
                  </strong>{" "}
                  — no credit card. Downgrade to Free anytime.
                </p>
              </div>
              <div className="mb-4 grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-2 block text-[13px] font-medium text-[var(--text)]">
                    First name
                  </label>
                  <input
                    type="text"
                    autoComplete="given-name"
                    placeholder="Rahul"
                    value={first}
                    onChange={(e) => setFirst(e.target.value)}
                    className="w-full rounded-[10px] border border-[var(--border-strong)] bg-white px-[14px] py-[11px] text-[14px] text-[var(--text)] outline-none transition-shadow focus:border-[var(--orange)] focus:shadow-[0_0_0_3px_rgba(224,123,60,0.12)]"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-[13px] font-medium text-[var(--text)]">
                    Last name
                  </label>
                  <input
                    type="text"
                    autoComplete="family-name"
                    placeholder="Sharma"
                    value={last}
                    onChange={(e) => setLast(e.target.value)}
                    className="w-full rounded-[10px] border border-[var(--border-strong)] bg-white px-[14px] py-[11px] text-[14px] text-[var(--text)] outline-none transition-shadow focus:border-[var(--orange)] focus:shadow-[0_0_0_3px_rgba(224,123,60,0.12)]"
                  />
                </div>
              </div>
              <div className="mb-4">
                <label className="mb-2 block text-[13px] font-medium text-[var(--text)]">
                  Email address
                </label>
                <input
                  type="email"
                  autoComplete="email"
                  placeholder="you@company.com"
                  value={regEmail}
                  onChange={(e) => setRegEmail(e.target.value)}
                  className="w-full rounded-[10px] border border-[var(--border-strong)] bg-white px-[14px] py-[11px] text-[14px] text-[var(--text)] outline-none transition-shadow focus:border-[var(--orange)] focus:shadow-[0_0_0_3px_rgba(224,123,60,0.12)]"
                />
                <p className="mt-[5px] text-[12px] text-[var(--muted-light)]">
                  Use .edu for 50% student discount on Pro.
                </p>
              </div>
              <div className="mb-5">
                <label className="mb-2 block text-[13px] font-medium text-[var(--text)]">
                  I&rsquo;m using Gap Map for
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {ROLE_OPTIONS.map((opt) => {
                    const selected = role === opt.value;
                    return (
                      <label
                        key={opt.value}
                        className={`cursor-pointer rounded-[10px] border px-3 py-3 transition-all ${
                          selected
                            ? "border-[var(--orange)] bg-[var(--orange-pale)]"
                            : "border-[var(--border-strong)] bg-white hover:border-[var(--orange)]"
                        }`}
                      >
                        <input
                          type="radio"
                          name="role"
                          className="sr-only"
                          checked={selected}
                          onChange={() => setRole(opt.value)}
                        />
                        <div
                          className={`text-[13px] font-medium ${
                            selected ? "text-[var(--orange)]" : "text-[var(--dark)]"
                          }`}
                        >
                          {opt.name}
                        </div>
                        <div className="text-[12px] text-[var(--muted)]">{opt.sub}</div>
                      </label>
                    );
                  })}
                </div>
              </div>
              <div className="mb-5">
                <label className="mb-2 block text-[13px] font-medium text-[var(--text)]">
                  Password
                </label>
                <div className="relative">
                  <input
                    type={showRegPwd ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="Min. 8 characters"
                    value={regPwd}
                    onChange={(e) => setRegPwd(e.target.value)}
                    className="w-full rounded-[10px] border border-[var(--border-strong)] bg-white px-[14px] py-[11px] pr-14 text-[14px] text-[var(--text)] outline-none transition-shadow focus:border-[var(--orange)] focus:shadow-[0_0_0_3px_rgba(224,123,60,0.12)]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowRegPwd((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] font-normal text-[var(--muted-light)] hover:text-[var(--muted)]"
                  >
                    {showRegPwd ? "Hide" : "Show"}
                  </button>
                </div>
                <p className="mt-[5px] text-[12px] text-[var(--muted-light)]">
                  Min. 8 characters.
                </p>
              </div>
              <button
                type="submit"
                disabled={regBusy}
                className="flex w-full items-center justify-center gap-2 rounded-[10px] bg-[var(--orange)] px-4 py-3 text-[15px] font-medium text-white transition-all hover:-translate-y-px hover:bg-[var(--orange-hover)] disabled:pointer-events-none disabled:opacity-70"
              >
                {regBusy ? "Creating account…" : "Create account & start trial"}
              </button>
              <p className="mt-5 text-center text-[13px] text-[var(--muted)]">
                Already have an account?{" "}
                <button
                  type="button"
                  onClick={() => switchTab("login")}
                  className="text-[var(--orange)] hover:underline"
                >
                  Sign in
                </button>
              </p>
            </form>
          ) : null}

          {tab === "forgot" ? (
            <form onSubmit={handleForgot} className="flex flex-col">
              <p className="mb-6 text-[14px] leading-[1.6] text-[var(--muted)]">
                Enter your email and we&rsquo;ll send a reset link. Check your
                spam folder if it doesn&rsquo;t arrive within 2 minutes.
              </p>
              <div className="mb-5">
                <label className="mb-2 block text-[13px] font-medium text-[var(--text)]">
                  Email address
                </label>
                <input
                  type="email"
                  placeholder="you@company.com"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  className="w-full rounded-[10px] border border-[var(--border-strong)] bg-white px-[14px] py-[11px] text-[14px] text-[var(--text)] outline-none transition-shadow focus:border-[var(--orange)] focus:shadow-[0_0_0_3px_rgba(224,123,60,0.12)]"
                />
              </div>
              <button
                type="submit"
                disabled={forgotBusy}
                className="flex w-full items-center justify-center gap-2 rounded-[10px] bg-[var(--dark)] px-4 py-3 text-[15px] font-medium text-white transition-all hover:-translate-y-px hover:bg-[var(--dark-mid)] disabled:pointer-events-none disabled:opacity-70"
              >
                {forgotBusy ? "Sending…" : "Send reset link"}
              </button>
              <p className="mt-5 text-center text-[13px] text-[var(--muted)]">
                <button
                  type="button"
                  onClick={() => switchTab("login")}
                  className="text-[var(--orange)] hover:underline"
                >
                  ← Back to sign in
                </button>
              </p>
            </form>
          ) : null}
        </div>
      </div>
    </div>
  );
}
