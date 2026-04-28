import { SECURITY_PILLARS } from "@/lib/constants";

export function SecurityTrustSection() {
  return (
    <section id="security" className="bg-[var(--cream)] px-8 py-[80px]">
      <div className="mx-auto max-w-[1200px]">
        <div className="grid gap-8 md:grid-cols-2">
          <div className="max-w-[560px]">
            <span className="section-label">Security and privacy</span>
            <h2 className="section-h2">
              Technical trust,
              <br />
              <em>designed into the stack.</em>
            </h2>
            <p className="section-sub">
              Gap Map is built for teams that need strong evidence workflows
              without leaking sensitive research artifacts to third-party clouds.
            </p>
            <div className="mt-6 rounded-[20px] border border-[var(--border-strong)] bg-[var(--cream-mid)] p-5">
              <p className="text-[13px] font-medium text-[var(--dark)]">
                What never leaves your machine
              </p>
              <ul className="mt-3 space-y-2 text-[13.5px] text-[var(--muted)]">
                <li>• Raw ingested posts and workspace notes</li>
                <li>• Extracted evidence graph and source links</li>
                <li>• Topic schemas, query configs, and report drafts</li>
              </ul>
            </div>
          </div>
          <div className="grid gap-4">
            {SECURITY_PILLARS.map((item) => (
              <article
                key={item.title}
                className="reveal rounded-[20px] border border-[var(--border-strong)] bg-white p-6"
              >
                <p className="text-[15px] font-medium text-[var(--dark)]">{item.title}</p>
                <p className="mt-2 text-[13.5px] leading-[1.6] text-[var(--muted)]">
                  {item.body}
                </p>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
