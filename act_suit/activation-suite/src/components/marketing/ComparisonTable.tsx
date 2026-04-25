import { COMPARISON_ROWS } from "@/lib/constants";

const COLUMNS = ["Capability", "Gap Map", "Dovetail", "Notion AI", "Manual research"] as const;

function Cell({ value }: { value: string }) {
  if (value === "yes") {
    return <span className="text-[18px] font-medium text-[var(--orange)]">✓</span>;
  }
  if (value === "no") {
    return <span className="text-[16px] text-[var(--muted-light)]">—</span>;
  }
  // partial / manual etc
  return <span className="text-[12.5px] font-medium capitalize text-[var(--muted)]">{value}</span>;
}

export function ComparisonTable() {
  return (
    <section id="compare" className="bg-[var(--cream)] px-8 py-[100px]">
      <div className="mx-auto max-w-[1200px]">
        <div className="max-w-[620px]">
          <span className="section-label">Comparison</span>
          <h2 className="section-h2">How Gap Map stacks up.</h2>
        </div>
        <div className="mt-12 overflow-x-auto rounded-[24px] border border-[var(--border-strong)] bg-white">
          <table className="min-w-full text-left">
            <thead>
              <tr className="border-b border-[var(--border)]">
                {COLUMNS.map((c, i) => (
                  <th
                    key={c}
                    className={`px-6 py-5 text-[13px] font-medium ${
                      i === 1
                        ? "bg-[var(--orange-pale)] text-[var(--orange)]"
                        : "text-[var(--muted)]"
                    }`}
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARISON_ROWS.map((row) => (
                <tr
                  key={row[0]}
                  className="border-b border-[var(--border)] last:border-b-0"
                >
                  <td className="px-6 py-5 text-[14px] font-medium text-[var(--dark)]">
                    {row[0]}
                  </td>
                  {row.slice(1).map((v, i) => (
                    <td
                      key={i}
                      className={`px-6 py-5 text-center ${
                        i === 0 ? "bg-[var(--orange-pale)]/40" : ""
                      }`}
                    >
                      <Cell value={v} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
