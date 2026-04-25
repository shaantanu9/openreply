import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { BRAND, FOOTER_COLUMNS } from "@/lib/constants";

export function Footer() {
  return (
    <footer className="bg-[var(--dark)] px-8 pb-12 pt-20 text-[var(--cream)]">
      <div className="mx-auto grid max-w-[1200px] gap-10 md:grid-cols-[2fr_1fr_1fr_1fr]">
        <div>
          <Logo tone="white" />
          <p className="mt-5 max-w-[360px] text-[14px] leading-relaxed text-white/45">
            {BRAND.tagline}
          </p>
        </div>
        {FOOTER_COLUMNS.map((col) => (
          <div key={col.title}>
            <h4 className="mb-4 text-[12px] font-medium uppercase tracking-[1px] text-white/35">
              {col.title}
            </h4>
            <ul className="flex flex-col gap-3">
              {col.links.map((l) => (
                <li key={`${col.title}-${l.label}`}>
                  <Link
                    href={l.href}
                    className="text-[14px] text-white/70 transition-colors hover:text-[var(--orange-light)]"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mx-auto mt-12 flex max-w-[1200px] flex-col gap-2 border-t border-white/10 pt-6 text-[12.5px] text-white/35 md:flex-row md:items-center md:justify-between">
        <p>{BRAND.copyright}</p>
        <p>{BRAND.footerStrap}</p>
      </div>
    </footer>
  );
}
