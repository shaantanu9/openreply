import React from "react";

type Tone = "orange" | "blue" | "green" | "gray";

const toneClasses: Record<Tone, { bar: string; badge: string }> = {
  orange: { bar: "bg-[var(--orange)]", badge: "bg-[var(--orange-pale)] text-[var(--orange)]" },
  blue: { bar: "bg-[#378ADD]", badge: "bg-[#EEF3FD] text-[#185FA5]" },
  green: { bar: "bg-[#1D9E75]", badge: "bg-[#EDF8F1] text-[#0F6E56]" },
  gray: { bar: "bg-[var(--cream-dark)]", badge: "bg-[var(--cream-dark)] text-[var(--muted)]" },
};

type Stat = { val: string; lbl: string; accent?: Tone };
type Bar = { label: string; value: number; tone: Tone; meta?: string };
type Tag = string;
type Brief = { dot: string; text: string; meta?: string };
type Paper = { index: string; title: string; authors: string; gap?: boolean };

type CardProps = {
  title: string;
  badge?: { text: string; tone: Tone };
  bars?: Bar[];
  tags?: Tag[];
  brief?: Brief[];
  papers?: Paper[];
};

function MockCard({ title, badge, bars, tags, brief, papers }: CardProps) {
  return (
    <div className="rounded-[10px] border border-[var(--border)] bg-white p-3">
      <div className="mb-[9px] flex items-center justify-between">
        <span className="text-[11.5px] font-medium text-[var(--dark)]">
          {title}
        </span>
        {badge ? (
          <span
            className={`rounded-full px-2 py-[2px] text-[10px] font-medium ${toneClasses[badge.tone].badge}`}
          >
            {badge.text}
          </span>
        ) : null}
      </div>
      {bars?.map((b) => {
        const { bar } = toneClasses[b.tone];
        return (
          <div key={b.label} className="mb-[5px] flex items-center gap-2">
            <span className="min-w-[82px] text-[10px] text-[var(--muted)]">
              {b.label}
            </span>
            <div className="h-1 flex-1 rounded-full bg-[var(--cream-dark)]">
              <div
                className={`h-1 rounded-full ${bar}`}
                style={{ width: `${b.value}%` }}
              />
            </div>
            <span className="min-w-[22px] text-right text-[10px] text-[var(--muted-light)]">
              {b.meta || `${b.value}%`}
            </span>
          </div>
        );
      })}
      {tags?.length ? (
        <div className="mt-[10px] flex flex-wrap gap-1">
          {tags.map((t) => (
            <span
              key={t}
              className="rounded-full border border-[var(--border)] bg-[var(--cream)] px-2 py-[2px] text-[10px] text-[var(--muted)]"
            >
              {t}
            </span>
          ))}
        </div>
      ) : null}
      {brief?.map((row, i) => (
        <div
          key={i}
          className="flex items-start gap-[10px] border-b border-[var(--border)] py-2 last:border-b-0"
        >
          <span
            className="mt-1 h-2 w-2 shrink-0 rounded-full"
            style={{ background: row.dot }}
          />
          <p className="flex-1 text-[11px] leading-[1.45] text-[var(--dark)]">
            {row.text}
          </p>
          {row.meta ? (
            <span className="text-[10px] text-[var(--muted-light)]">{row.meta}</span>
          ) : null}
        </div>
      ))}
      {papers?.map((p, i) => (
        <div
          key={i}
          className="flex items-start gap-[10px] border-b border-[var(--border)] py-2 last:border-b-0"
        >
          <span className="mt-[2px] min-w-[18px] text-[10px] font-medium text-[var(--muted-light)]">
            {p.index}
          </span>
          <div className="flex-1">
            <p className="mb-[2px] text-[11px] font-medium leading-[1.35] text-[var(--dark)]">
              {p.title}
              {p.gap ? (
                <span className="ml-[6px] rounded-full bg-[#EEF3FD] px-[7px] py-[2px] text-[9.5px] text-[#185FA5]">
                  gap
                </span>
              ) : null}
            </p>
            <p className="text-[10px] text-[var(--muted-light)]">{p.authors}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

type Props = {
  titlebar: string;
  stats: Stat[];
  card: CardProps;
  secondCard?: CardProps;
};

export function AppWindowMock({ titlebar, stats, card, secondCard }: Props) {
  return (
    <div className="overflow-hidden rounded-[24px] border border-[var(--border-strong)] bg-white shadow-[0_2px_0_rgba(0,0,0,0.04),0_12px_40px_rgba(0,0,0,0.07),0_40px_80px_rgba(0,0,0,0.06)]">
      <div className="flex items-center gap-[10px] border-b border-[var(--border)] bg-[#F9F7F4] px-[14px] py-[10px]">
        <div className="flex gap-[5px]">
          <span className="h-[10px] w-[10px] rounded-full bg-[#FF6158]" />
          <span className="h-[10px] w-[10px] rounded-full bg-[#FFBE2E]" />
          <span className="h-[10px] w-[10px] rounded-full bg-[#29CA42]" />
        </div>
        <span className="m-auto text-[11.5px] text-[var(--muted-light)]">
          {titlebar}
        </span>
      </div>
      <div className="bg-[var(--cream-mid)] p-4">
        <div className="mb-3 grid grid-cols-2 gap-[7px] sm:grid-cols-4">
          {stats.map((s) => (
            <div
              key={s.lbl}
              className="rounded-[10px] border border-[var(--border)] bg-white px-3 py-[10px]"
            >
              <div
                className={`text-[20px] font-medium leading-none ${
                  s.accent ? `text-[var(--orange)]` : "text-[var(--dark)]"
                }`}
                style={
                  s.accent === "blue"
                    ? { color: "#378ADD" }
                    : s.accent === "green"
                    ? { color: "#1D9E75" }
                    : undefined
                }
              >
                {s.val}
              </div>
              <div className="mt-[2px] text-[10px] text-[var(--muted-light)]">
                {s.lbl}
              </div>
            </div>
          ))}
        </div>
        <MockCard {...card} />
        {secondCard ? (
          <div className="mt-2">
            <MockCard {...secondCard} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
