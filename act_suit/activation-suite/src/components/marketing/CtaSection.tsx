import { DownloadArrow } from "@/components/marketing/DownloadArrow";
import { DownloadLink } from "@/components/shell/DownloadLink";

export function CtaSection() {
  return (
    <section id="cta" className="bg-[var(--cream)] px-8 py-[100px]">
      <div className="relative mx-auto max-w-[1200px] overflow-hidden rounded-[28px] bg-[var(--dark)] px-10 py-20 text-center text-white">
        <div
          aria-hidden
          className="absolute inset-0 opacity-70"
          style={{
            background:
              "radial-gradient(600px 300px at 50% 0%, rgba(224,123,60,0.22), transparent 70%)",
          }}
        />
        <div className="relative">
          <h2 className="mx-auto max-w-[820px] font-serif text-[clamp(34px,4.5vw,52px)] font-normal leading-[1.1] tracking-[-1.2px]">
            Start your first
            <br />
            research sweep <em className="italic text-[var(--orange-light)]">today.</em>
          </h2>
          <p className="mx-auto mt-5 max-w-[520px] text-[15px] leading-[1.7] text-white/60">
            Download for Mac, activate your free account, and run your first
            40k-post gap scan in under 10 minutes.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <DownloadLink className="btn btn-lg btn-orange">
              <DownloadArrow />
              Download for Mac — Free
            </DownloadLink>
            <a
              href="/sign-in"
              className="btn btn-lg border border-white/20 bg-white/[0.06] text-white hover:bg-white/10"
            >
              Get early access — free in beta →
            </a>
            <a
              href="/pricing"
              className="btn btn-lg border border-white/20 bg-white/[0.06] text-white hover:bg-white/10"
            >
              Why it&rsquo;s free in beta →
            </a>
          </div>
          <p className="mt-5 text-[12.5px] text-white/45">
            macOS 13+ · Apple Silicon &amp; Intel · Account + activation required
            before first workspace
          </p>
        </div>
      </div>
    </section>
  );
}
