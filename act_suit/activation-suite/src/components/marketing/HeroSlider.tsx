"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AppWindowMock } from "@/components/marketing/AppWindowMock";
import { DownloadArrow } from "@/components/marketing/DownloadArrow";
import { DownloadLink } from "@/components/shell/DownloadLink";
import { HERO_SLIDES } from "@/lib/constants";

const SLIDE_MS = 5500;

type PersonaTone = "orange" | "blue" | "green";

const personaStyles: Record<PersonaTone, { container: string; dot: string }> = {
  orange: {
    container:
      "bg-[var(--orange-pale)] border border-[rgba(224,123,60,0.25)] text-[#B5581A]",
    dot: "bg-[var(--orange)]",
  },
  blue: {
    container:
      "bg-[#EEF3FD] border border-[rgba(55,138,221,0.25)] text-[#185FA5]",
    dot: "bg-[#378ADD]",
  },
  green: {
    container:
      "bg-[#EDF8F1] border border-[rgba(29,158,117,0.25)] text-[#0F6E56]",
    dot: "bg-[#1D9E75]",
  },
};

const avatarTones: Record<
  "cream" | "blue" | "green",
  { bg: string; border: string; color: string }
> = {
  cream: { bg: "var(--cream-dark)", border: "var(--cream)", color: "var(--muted)" },
  blue: { bg: "#EEF3FD", border: "var(--cream)", color: "#185FA5" },
  green: { bg: "#EDF8F1", border: "var(--cream)", color: "#0F6E56" },
};

const ctaVariants: Record<"orange" | "blue" | "green", string> = {
  orange: "bg-[var(--orange)] text-white hover:bg-[var(--orange-hover)]",
  blue: "bg-[#185FA5] text-white hover:bg-[#144d86]",
  green: "bg-[#0F6E56] text-white hover:bg-[#0c5a47]",
};

function personaToneFrom(className: string): PersonaTone {
  if (className.includes("researcher")) return "blue";
  if (className.includes("pm")) return "green";
  return "orange";
}

function renderHeadline(headline: readonly unknown[]) {
  return headline.map((seg, i) => {
    if (typeof seg === "string") {
      if (i === 0) return <span key={i}>{seg}</span>;
      return (
        <span key={i}>
          <br />
          {seg}
        </span>
      );
    }
    const o = seg as {
      em?: string;
      color?: "orange" | "blue" | "green";
      literature?: boolean;
    };
    const colorStyle =
      o.color === "blue"
        ? "text-[#378ADD]"
        : o.color === "green"
        ? "text-[#1D9E75]"
        : "text-[var(--orange)]";
    if (o.literature) {
      return (
        <span key={i}>
          <br />
          literature{" "}
          <em className={`italic text-[#378ADD]`}>before</em>
          <br />
        </span>
      );
    }
    if (o.em) {
      return (
        <span key={i}>
          <br />
          <em className={`italic ${colorStyle}`}>{o.em}</em>
        </span>
      );
    }
    return null;
  });
}

function TrustRow({
  avatars,
  line,
}: {
  avatars: readonly { initials: string; tone: "cream" | "blue" | "green" }[];
  line: string;
}) {
  const parts = line.split(/\*\*(.+?)\*\*/g);
  return (
    <div className="mt-8 flex items-center gap-[10px]">
      <div className="flex">
        {avatars.map((a, i) => {
          const tone = avatarTones[a.tone];
          return (
            <span
              key={i}
              className={`-ml-[6px] flex h-[27px] w-[27px] items-center justify-center rounded-full border-2 text-[10px] font-semibold first:ml-0`}
              style={{
                background: tone.bg,
                borderColor: tone.border,
                color: tone.color,
              }}
            >
              {a.initials}
            </span>
          );
        })}
      </div>
      <p className="text-[13px] text-[var(--muted-light)]">
        {parts.map((part, i) =>
          i % 2 === 1 ? (
            <strong key={i} className="font-medium text-[var(--muted)]">
              {part}
            </strong>
          ) : (
            <span key={i}>{part}</span>
          ),
        )}
      </p>
    </div>
  );
}

function HeroFloat({
  tone,
  label,
  body,
}: {
  tone: "orange" | "blue" | "green";
  label: string;
  body: string;
}) {
  const labelColor =
    tone === "blue"
      ? "text-[#185FA5]"
      : tone === "green"
      ? "text-[#0F6E56]"
      : "text-[var(--orange)]";
  const borderColor =
    tone === "blue"
      ? "border-[#B8D1EC]"
      : tone === "green"
      ? "border-[#A6D9C4]"
      : "border-[rgba(224,123,60,0.35)]";
  const parts = body.split(/\*\*(.+?)\*\*/g);
  return (
    <div
      className={`animate-float absolute -bottom-[14px] -left-[18px] max-w-[210px] rounded-[16px] border ${borderColor} bg-white px-[15px] py-[11px]`}
    >
      <div
        className={`mb-[5px] text-[10px] font-medium uppercase tracking-[0.8px] ${labelColor}`}
      >
        {label}
      </div>
      <p className="text-[11px] leading-[1.4] text-[var(--dark)]">
        {parts.map((part, i) =>
          i % 2 === 1 ? (
            <b key={i} className="font-medium">
              {part}
            </b>
          ) : (
            <span key={i}>{part}</span>
          ),
        )}
      </p>
    </div>
  );
}

export function HeroSlider() {
  const [active, setActive] = useState(0);
  const intervalRef = useRef<number | null>(null);

  const clearTimer = useCallback(() => {
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const startTimer = useCallback(() => {
    clearTimer();
    intervalRef.current = window.setInterval(() => {
      setActive((prev) => (prev + 1) % HERO_SLIDES.length);
    }, SLIDE_MS);
  }, [clearTimer]);

  useEffect(() => {
    startTimer();
    return clearTimer;
  }, [startTimer, clearTimer]);

  const goTo = useCallback(
    (idx: number) => {
      const next = ((idx % HERO_SLIDES.length) + HERO_SLIDES.length) % HERO_SLIDES.length;
      setActive(next);
      startTimer();
    },
    [startTimer],
  );

  return (
    <section
      id="hero"
      className="relative min-h-screen overflow-hidden bg-[var(--cream)] pt-[60px]"
    >
      <div
        className="absolute right-8 top-6 text-[12px] font-medium text-[var(--muted-light)] tracking-[0.5px]"
        aria-live="polite"
      >
        {active + 1} / {HERO_SLIDES.length}
      </div>

      <div className="relative min-h-[calc(100vh-60px)] w-full">
        {HERO_SLIDES.map((slide, idx) => {
          const isActive = idx === active;
          const tone = personaToneFrom(slide.persona.className);
          const persona = personaStyles[tone];
          return (
            <div
              key={slide.id}
              className={`absolute inset-0 flex items-center px-8 py-[60px] transition-opacity duration-500 ${
                isActive ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
              }`}
              style={{ minHeight: "calc(100vh - 60px)" }}
              aria-hidden={!isActive}
            >
              <div className="mx-auto grid w-full max-w-[1200px] grid-cols-1 items-center gap-16 md:grid-cols-2">
                <div>
                  <span
                    className={`mb-6 inline-flex items-center gap-2 rounded-full px-[14px] py-[5px] pl-[10px] text-[12px] font-medium ${persona.container}`}
                  >
                    <span className={`h-[7px] w-[7px] rounded-full ${persona.dot}`} />
                    {slide.persona.label}
                  </span>
                  <h1 className="mb-[22px] font-serif font-normal text-[var(--dark)]"
                      style={{
                        fontSize: "clamp(38px, 4.5vw, 56px)",
                        lineHeight: 1.1,
                        letterSpacing: "-1.5px",
                      }}
                  >
                    {renderHeadline(slide.headline as readonly unknown[])}
                  </h1>
                  <p className="mb-8 max-w-[440px] text-[17px] font-light leading-[1.7] text-[var(--muted)]">
                    {slide.sub}
                  </p>
                  <span className="mb-4 inline-flex items-center gap-2 rounded-full border border-[rgba(224,123,60,0.3)] bg-[var(--orange-pale)] px-3 py-[5px] text-[12px] font-semibold uppercase tracking-[0.8px] text-[var(--orange)]">
                    🔒 Invite-only beta · limited founding seats
                  </span>
                  <div className="flex flex-wrap items-center gap-3">
                    <DownloadLink
                      className={`btn btn-lg !text-white [&_*]:!text-white ${ctaVariants[slide.primaryCta.variant]}`}
                    >
                      <DownloadArrow />
                      {slide.primaryCta.label}
                    </DownloadLink>
                    <a href="/sign-in" className="btn btn-ghost btn-lg">
                      Claim your founding invite →
                    </a>
                  </div>
                  <p className="mt-3 text-[12.5px] text-[var(--muted-light)]">
                    {"ctaNote" in slide ? slide.ctaNote : "Free during beta · no card · or join the waitlist in 10s"}
                  </p>
                  {"microProof" in slide ? (
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      {slide.microProof.map((chip: string) => (
                        <span
                          key={chip}
                          className="rounded-full border border-[var(--border)] bg-[var(--cream-mid)] px-[10px] py-[4px] text-[11px] font-medium text-[var(--muted)]"
                        >
                          {chip}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <TrustRow avatars={slide.trust.avatars} line={slide.trust.line} />
                </div>
                <div className="relative">
                  <AppWindowMock
                    titlebar={slide.mock.titlebar}
                    stats={slide.mock.stats as never}
                    card={slide.mock.card as never}
                    secondCard={"secondCard" in slide.mock ? (slide.mock.secondCard as never) : undefined}
                  />
                  <HeroFloat
                    tone={slide.mock.float.tone}
                    label={slide.mock.float.label}
                    body={slide.mock.float.body}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="absolute bottom-8 left-1/2 z-10 flex -translate-x-1/2 items-center gap-5">
        <button
          type="button"
          onClick={() => goTo(active - 1)}
          aria-label="Previous slide"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border-strong)] bg-white text-[14px] text-[var(--muted)] transition-colors hover:bg-[var(--cream-dark)] hover:text-[var(--dark)]"
        >
          ‹
        </button>
        <div className="flex items-center gap-2">
          {HERO_SLIDES.map((_, idx) => {
            const isActive = idx === active;
            return (
              <button
                key={idx}
                type="button"
                onClick={() => goTo(idx)}
                aria-label={`Go to slide ${idx + 1}`}
                className={`relative h-2 overflow-hidden border-0 p-0 transition-all ${
                  isActive ? "w-7 rounded-[4px] bg-[var(--dark)]" : "w-2 rounded-full bg-[rgba(46,40,32,0.2)]"
                }`}
              >
                {isActive ? (
                  <span
                    className="absolute inset-y-0 left-0 rounded-[4px] bg-[var(--orange)]"
                    style={{
                      animation: `dotFill ${SLIDE_MS}ms linear forwards`,
                    }}
                  />
                ) : null}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => goTo(active + 1)}
          aria-label="Next slide"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border-strong)] bg-white text-[14px] text-[var(--muted)] transition-colors hover:bg-[var(--cream-dark)] hover:text-[var(--dark)]"
        >
          ›
        </button>
      </div>
    </section>
  );
}
