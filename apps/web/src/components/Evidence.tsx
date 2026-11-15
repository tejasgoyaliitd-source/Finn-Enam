import type { ReactNode } from "react";
import { FileText } from "lucide-react";
import { num } from "../lib/format";
import { TrendPct } from "./TrendPct";
import type { CheckStatus, ResultsDetail, SourceRef } from "../lib/queries";

/** "Results filing, p.10": opens the PDF at that page. Never a bare "Source". */
export function SourceChip({ source }: { source: SourceRef }) {
  const href = source.page ? `${source.url}#page=${source.page}` : source.url;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="press inline-flex min-h-11 items-center gap-1.5 rounded-pill border border-rule bg-sheet px-3 text-caption font-medium text-royal hover:bg-ledger"
    >
      <FileText size={15} strokeWidth={1.75} aria-hidden="true" />
      {source.label}
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

export function ChipRow({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-2">{children}</div>;
}

/**
 * Four lines, quarter on quarter and year on year, in ₹ crore. Tabular numbers line up;
 * the margin row shows its change in basis points.
 */
export function ResultsTable({ r }: { r: ResultsDetail }) {
  const dash = <span className="text-ink-3">–</span>;
  return (
    <table className="w-full border-collapse text-num">
      <caption className="sr-only">
        {r.period} results{r.basis ? `, ${r.basis}` : ""}, in rupees crore
      </caption>
      <thead>
        <tr className="bg-ledger text-caption text-ink-2">
          <th scope="col" className="rounded-l-[6px] py-2 pl-2 text-left font-medium">
            ₹ cr
          </th>
          <th scope="col" className="py-2 text-right font-medium">
            {r.period}
          </th>
          <th scope="col" className="py-2 text-right font-medium">
            QoQ
          </th>
          <th scope="col" className="rounded-r-[6px] py-2 pr-2 text-right font-medium">
            YoY
          </th>
        </tr>
      </thead>
      <tbody>
        {r.rows.map((row) => (
          <tr key={row.label} className="border-b border-rule last:border-b-0">
            <th scope="row" className="py-2.5 pl-2 text-left font-normal text-ink-2">
              {row.label}
            </th>
            <td className="py-2.5 text-right font-medium text-ink">{row.value === null ? dash : row.kind === "margin" ? `${num(row.value, 1)}%` : num(row.value)}</td>
            <td className="py-2.5 pl-2 text-right">
              {row.qoq === null ? dash : <TrendPct value={row.qoq} digits={0} isBps={row.kind === "margin"} />}
            </td>
            <td className="py-2.5 pl-2 pr-2 text-right">
              {row.yoy === null ? dash : <TrendPct value={row.yoy} digits={0} isBps={row.kind === "margin"} />}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const CHECK: Record<CheckStatus, { glyph: string; tone: string; word: string }> = {
  pass: { glyph: "✓", tone: "text-met", word: "Checked" },
  flag: { glyph: "!", tone: "text-behind-mark", word: "Note" },
  fail: { glyph: "✕", tone: "text-missed", word: "Failed" },
  skipped: { glyph: "–", tone: "text-ink-3", word: "Not checked" },
};

/** ✓ for math that ties, ! for what needs a look. The glyph carries the meaning; the colour repeats it. */
export function CheckList({ checks }: { checks: { status: CheckStatus; text: string; page: number | null }[] }) {
  return (
    <ul className="space-y-2">
      {checks.map((c, i) => (
        <li key={i} className="flex gap-2.5 text-body">
          <span aria-hidden="true" className={`w-4 shrink-0 text-center font-semibold ${CHECK[c.status].tone}`}>
            {CHECK[c.status].glyph}
          </span>
          <span className="text-ink">
            <span className="sr-only">{CHECK[c.status].word}: </span>
            {c.text}
            {c.page ? <span className="text-ink-3"> (p.{c.page})</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Management's own words: Plex Serif, a left rule, and the page it came from. */
export function QuoteBlock({ quote, source }: { quote: string; source?: SourceRef | null }) {
  return (
    <figure className="space-y-2">
      <blockquote className="quote border-l-2 border-rule pl-3 text-ink">“{quote}”</blockquote>
      {source && (
        <figcaption>
          <SourceChip source={source} />
        </figcaption>
      )}
    </figure>
  );
}
