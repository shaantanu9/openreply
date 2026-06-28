import { BEFORE_AFTER } from "@/lib/constants";

/**
 * Side-by-side workflow contrast. Single most powerful conversion
 * device for B2B SaaS — replaces vague claims ("faster") with concrete
 * line-item differences the reader can map onto their own day.
 *
 * Visual rule: muted gray treatment on the left, full-color brand on
 * the right. The accent panel deliberately overlaps the divider line
 * by 1px so the eye reads "after" as the wider, dominant column.
 */
function CheckRow({ text, kind }: { text: string; kind: "x" | "✓" }) {
  const isWin = kind === "✓";
  return (
    <li className="flex items-start gap-3">
      <span
        aria-hidden
        className={`mt-[2px] flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold ${
          isWin
            ? "bg-[var(--orange)] text-white"
            : "bg-[var(--cream-dark)] text-[var(--muted-light)]"
        }`}
      >
        {isWin ? "✓" : "×"}
      </span>
      <span
        className={`text-[14px] leading-[1.6] ${
          isWin ? "text-[var(--dark)]" : "text-[var(--muted)] line-through decoration-[var(--muted-light)]"
        }`}
      >
        {text}
      </span>
    </li>
  );
}

export function BeforeAfterSection() {
  const { before, after } = BEFORE_AFTER;
  return (
    <section
      id="before-after"
      className="bg-[var(--cream-mid)] px-8 py-[100px]"
    >
      <div className="mx-auto max-w-[1200px]">
        <div className="mx-auto max-w-[640px] text-center">
          <span className="section-label">Before / after</span>
          <h2 className="section-h2">
            From spreadsheet sprawl to
            <br />
            <em>one auditable graph.</em>
          </h2>
          <p className="section-sub mx-auto mt-3">
            Same week. Same product team. Same 1,890 posts of customer signal.
            Two very different outcomes.
          </p>
        </div>

        <div className="mt-12 grid gap-0 overflow-hidden rounded-[28px] border border-[var(--border-strong)] bg-white md:grid-cols-2">
          {/* BEFORE */}
          <div className="reveal flex flex-col gap-5 bg-[var(--cream-dark)] p-6 sm:p-10">
            <span className="text-[11px] font-medium uppercase tracking-[1.5px] text-[var(--muted-light)]">
              {before.label}
            </span>
            <h3 className="font-serif text-[24px] font-normal leading-tight tracking-[-0.5px] text-[var(--muted)]">
              {before.title}
            </h3>
            <ul className="mt-2 flex flex-col gap-3">
              {before.items.map((item) => (
                <CheckRow key={item} text={item} kind="x" />
              ))}
            </ul>
            <p className="mt-auto pt-6 text-[12px] font-mono uppercase tracking-[1.5px] text-[var(--muted-light)]">
              ~23 hours / week · 4 tools · zero receipts
            </p>
          </div>

          {/* AFTER */}
          <div className="reveal relative flex flex-col gap-5 bg-white p-6 sm:p-10 md:-ml-px md:border-l md:border-[var(--border-strong)]">
            <span
              className="absolute right-6 top-6 inline-flex items-center gap-2 rounded-full bg-[var(--orange-pale)] px-3 py-[4px] text-[10.5px] font-medium uppercase tracking-[1.2px] text-[var(--orange)]"
            >
              <span className="h-[6px] w-[6px] rounded-full bg-[var(--orange)]" />
              The OpenReply way
            </span>
            <span className="text-[11px] font-medium uppercase tracking-[1.5px] text-[var(--orange)]">
              {after.label}
            </span>
            <h3 className="font-serif text-[24px] font-normal leading-tight tracking-[-0.5px] text-[var(--dark)]">
              {after.title}
            </h3>
            <ul className="mt-2 flex flex-col gap-3">
              {after.items.map((item) => (
                <CheckRow key={item} text={item} kind="✓" />
              ))}
            </ul>
            <p className="mt-auto pt-6 text-[12px] font-mono uppercase tracking-[1.5px] text-[var(--orange)]">
              ~3 hours / week · 1 app · every claim cited
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
