import { BEFORE_AFTER, BEFORE_AFTER_STAT } from "@/lib/constants";

/**
 * Side-by-side workflow contrast — tightened: 72px section padding,
 * 7-point internal padding, and a 3-cell stats strip pinned to the
 * bottom of the panel so the eye lands on a concrete delta instead of
 * floating into whitespace.
 */
function CheckRow({ text, kind }: { text: string; kind: "x" | "✓" }) {
  const isWin = kind === "✓";
  return (
    <li className="flex items-start gap-3">
      <span
        aria-hidden
        className={`mt-[2px] flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
          isWin
            ? "bg-[var(--orange)] text-white"
            : "bg-[var(--cream-dark)] text-[var(--muted-light)]"
        }`}
      >
        {isWin ? "✓" : "×"}
      </span>
      <span
        className={`text-[13.5px] leading-[1.55] ${
          isWin
            ? "text-[var(--dark)]"
            : "text-[var(--muted)] line-through decoration-[var(--muted-light)]"
        }`}
      >
        {text}
      </span>
    </li>
  );
}

function MiniStat({
  num,
  label,
  tone,
}: {
  num: string;
  label: string;
  tone: "before" | "after";
}) {
  const numColor = tone === "after" ? "text-[var(--orange)]" : "text-[var(--muted)]";
  return (
    <div className="flex flex-col">
      <span className={`font-serif text-[22px] font-normal leading-none tracking-[-0.6px] ${numColor}`}>
        {num}
      </span>
      <span className="mt-1 text-[10px] font-medium uppercase tracking-[1.2px] text-[var(--muted-light)]">
        {label}
      </span>
    </div>
  );
}

export function BeforeAfterSection() {
  const { before, after } = BEFORE_AFTER;
  return (
    <section
      id="before-after"
      className="bg-[var(--cream-mid)] px-8 py-[72px]"
    >
      <div className="mx-auto max-w-[1200px]">
        <div className="mx-auto max-w-[640px] text-center">
          <span className="section-label">Before / after</span>
          <h2 className="font-serif text-[clamp(30px,3.4vw,42px)] font-normal leading-[1.1] tracking-[-1.2px] text-[var(--dark)]">
            From spreadsheet sprawl to
            <br />
            <em>one auditable graph.</em>
          </h2>
          <p className="mx-auto mt-3 max-w-[560px] text-[14.5px] leading-[1.65] text-[var(--muted)]">
            Same week. Same product team. Same 1,890 posts of customer signal.
            Two very different outcomes.
          </p>
        </div>

        <div className="mt-10 grid gap-0 overflow-hidden rounded-[24px] border border-[var(--border-strong)] bg-white md:grid-cols-2">
          {/* BEFORE */}
          <div className="reveal flex flex-col gap-4 bg-[var(--cream-dark)] p-7">
            <span className="text-[10.5px] font-medium uppercase tracking-[1.4px] text-[var(--muted-light)]">
              {before.label}
            </span>
            <h3 className="font-serif text-[22px] font-normal leading-tight tracking-[-0.4px] text-[var(--muted)]">
              {before.title}
            </h3>
            <ul className="mt-1 flex flex-col gap-[10px]">
              {before.items.map((item) => (
                <CheckRow key={item} text={item} kind="x" />
              ))}
            </ul>
            <div className="mt-auto grid grid-cols-3 gap-3 border-t border-[var(--border)] pt-4">
              <MiniStat num={BEFORE_AFTER_STAT.before.sources} label="sources" tone="before" />
              <MiniStat
                num={BEFORE_AFTER_STAT.before.dedup}
                label="deduped"
                tone="before"
              />
              <MiniStat
                num={BEFORE_AFTER_STAT.before.citations}
                label="cited"
                tone="before"
              />
            </div>
          </div>

          {/* AFTER */}
          <div className="reveal relative flex flex-col gap-4 bg-white p-7 md:-ml-px md:border-l md:border-[var(--border-strong)]">
            <span className="absolute right-5 top-5 inline-flex items-center gap-2 rounded-full bg-[var(--orange-pale)] px-3 py-[3px] text-[10px] font-medium uppercase tracking-[1.2px] text-[var(--orange)]">
              <span className="h-[5px] w-[5px] rounded-full bg-[var(--orange)]" />
              Gap Map
            </span>
            <span className="text-[10.5px] font-medium uppercase tracking-[1.4px] text-[var(--orange)]">
              {after.label}
            </span>
            <h3 className="font-serif text-[22px] font-normal leading-tight tracking-[-0.4px] text-[var(--dark)]">
              {after.title}
            </h3>
            <ul className="mt-1 flex flex-col gap-[10px]">
              {after.items.map((item) => (
                <CheckRow key={item} text={item} kind="✓" />
              ))}
            </ul>
            <div className="mt-auto grid grid-cols-3 gap-3 border-t border-[var(--border)] pt-4">
              <MiniStat num={BEFORE_AFTER_STAT.after.sources} label="sources" tone="after" />
              <MiniStat
                num={BEFORE_AFTER_STAT.after.dedup}
                label="deduped"
                tone="after"
              />
              <MiniStat
                num={BEFORE_AFTER_STAT.after.citations}
                label="cited"
                tone="after"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
