import type { Metadata } from "next";
import Link from "next/link";
import { SiteShell } from "@/components/shell/SiteShell";
import { BRAND, ROUTES } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Gap Map — Activation help",
};

export const revalidate = 3600;

export default function ActivationHelpPage() {
  return (
    <SiteShell navVariant="compact">
      <main className="mx-auto max-w-[860px] px-6 pb-16 pt-10">
        <h1 className="font-serif text-[38px] leading-[1.15] text-[var(--dark)]">
          Activation help
        </h1>
        <p className="mt-3 max-w-[700px] text-[15px] text-[var(--muted)]">
          Use this page to complete activation correctly. Desktop access is
          unlocked only after account + activation key verification.
        </p>

        <section className="mt-6 rounded-[12px] border border-[var(--border)] bg-[var(--cream-mid)] px-5 py-4">
          <h3 className="mb-2 text-[14px] uppercase tracking-[0.06em] text-[var(--muted)]">
            Required flow
          </h3>
          <ol className="ml-5 grid list-decimal gap-[6px] text-[15px] text-[var(--text)]">
            <li>
              Create account on{" "}
              <Link href={ROUTES.signIn} className="text-[var(--orange)] hover:underline">
                Sign in / Create account
              </Link>
              .
            </li>
            <li>
              Buy Pro/Live Pass (or start trial) from{" "}
              <Link href="/#pricing" className="text-[var(--orange)] hover:underline">
                Pricing
              </Link>
              .
            </li>
            <li>Get key from Lemon Squeezy purchase email or customer portal.</li>
            <li>
              Enter key on{" "}
              <Link href={ROUTES.activate} className="text-[var(--orange)] hover:underline">
                Activate licence
              </Link>
              .
            </li>
            <li>Open desktop app and sign in with same email.</li>
          </ol>
        </section>

        <section className="mt-4 rounded-[12px] border border-[var(--border)] bg-[var(--cream-mid)] px-5 py-4">
          <h3 className="mb-2 text-[14px] uppercase tracking-[0.06em] text-[var(--muted)]">
            Where to find activation key
          </h3>
          <ul className="ml-5 grid list-disc gap-[6px] text-[15px] text-[var(--text)]">
            <li>Purchase confirmation email from Lemon Squeezy.</li>
            <li>Customer portal order history (invoice + key details).</li>
            <li>If missing, use mail support link from Activate page.</li>
          </ul>
        </section>

        <section className="mt-4 rounded-[12px] border border-[var(--border)] bg-[var(--cream-mid)] px-5 py-4">
          <h3 className="mb-2 text-[14px] uppercase tracking-[0.06em] text-[var(--muted)]">
            Common issues
          </h3>
          <ul className="ml-5 grid list-disc gap-[6px] text-[15px] text-[var(--text)]">
            <li>
              <strong>Invalid key:</strong> Copy exact key format{" "}
              <code className="rounded bg-[var(--cream-dark)] px-1 font-mono text-[13px]">
                XXXX-XXXX-XXXX-XXXX
              </code>
              .
            </li>
            <li>
              <strong>Device limit reached:</strong> Deactivate old device or
              upgrade plan.
            </li>
            <li>
              <strong>Session expired:</strong> Sign in again before activating.
            </li>
            <li>
              <strong>Service unavailable:</strong> Retry after 1-2 minutes and
              verify API status.
            </li>
          </ul>
        </section>

        <section className="mt-4 rounded-[12px] border border-[var(--border)] bg-[var(--cream-mid)] px-5 py-4">
          <h3 className="mb-2 text-[14px] uppercase tracking-[0.06em] text-[var(--muted)]">
            Need manual help?
          </h3>
          <p className="text-[15px] text-[var(--text)]">
            Contact{" "}
            <a
              href={`mailto:${BRAND.supportEmail}?subject=Gap%20Map%20activation%20help`}
              className="text-[var(--orange)] hover:underline"
            >
              {BRAND.supportEmail}
            </a>{" "}
            with your account email and order ID.
          </p>
        </section>
      </main>
    </SiteShell>
  );
}
