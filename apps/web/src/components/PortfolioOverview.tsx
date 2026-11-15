import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { istDate, MINUS } from "../lib/format";
import { q } from "../lib/queries";
import { SegmentedControl } from "./SegmentedControl";
import { TrendPct } from "./TrendPct";

/**
 * The book at a glance: how its value moved over a chosen range, and how many holdings are off
 * track, on watch or on track. Every figure is real: the line is the holdings' stored closes,
 * weighted by portfolio weight, as an index (first session = 100). There is no rupee total because
 * the ledger holds weights, not quantities.
 */

type Range = "1D" | "1W" | "1M" | "3M" | "6M" | "All";
/** Sessions back from the latest close. */
const SESSIONS: Record<Range, number> = { "1D": 1, "1W": 5, "1M": 21, "3M": 63, "6M": 126, All: Infinity };
const RANGE_WORD: Record<Range, string> = { "1D": "today", "1W": "this week", "1M": "this month", "3M": "in 3 months", "6M": "in 6 months", All: "since" };

function ValueLine({ points }: { points: { date: string; index: number }[] }) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const W = 320;
  const H = 120;
  const vals = points.map((p) => p.index);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const pad = (max - min || 1) * 0.12;
  const lo = min - pad;
  const hi = max + pad;
  const x = (i: number) => 4 + (i / Math.max(1, points.length - 1)) * (W - 8);
  const y = (v: number) => 8 + (1 - (v - lo) / (hi - lo)) * (H - 16);
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.index).toFixed(1)}`).join("");
  const area = `${d}L${x(points.length - 1).toFixed(1)},${H}L${x(0).toFixed(1)},${H}Z`;
  const up = vals.at(-1)! >= vals[0]!;
  const shown = hover ?? points.length - 1;
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const rel = ((e.clientX - r.left) / r.width) * W;
    setHover(Math.max(0, Math.min(points.length - 1, Math.round(((rel - 4) / (W - 8)) * (points.length - 1)))));
  };
  return (
    <figure className="space-y-1">
      <figcaption className="flex items-baseline justify-between text-caption" aria-live="polite">
        <span className="text-ink-3">{istDate(`${points[shown]!.date}T12:00:00+05:30`)}</span>
        <span className="text-ink-2">
          Index <span className="text-num font-semibold text-ink">{points[shown]!.index.toFixed(1)}</span>
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full touch-none" role="img" aria-labelledby={`${id}-t`} onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)}>
        <title id={`${id}-t`}>{`Portfolio value index from ${points[0]!.index.toFixed(1)} on ${istDate(`${points[0]!.date}T12:00:00+05:30`)} to ${points.at(-1)!.index.toFixed(1)} on ${istDate(`${points.at(-1)!.date}T12:00:00+05:30`)}`}</title>
        <defs>
          <linearGradient id={`${id}-g`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={up ? "var(--color-met)" : "var(--color-missed)"} stopOpacity="0.14" />
            <stop offset="1" stopColor={up ? "var(--color-met)" : "var(--color-missed)"} stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1={0} x2={W} y1={y(vals[0]!)} y2={y(vals[0]!)} stroke="var(--color-rule)" strokeDasharray="3 3" />
        <path d={area} fill={`url(#${id}-g)`} />
        <path d={d} fill="none" stroke={up ? "var(--color-met)" : "var(--color-missed)"} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={0} y2={H} stroke="var(--color-ink-3)" strokeWidth={1} />}
        <circle cx={x(shown)} cy={y(points[shown]!.index)} r={4} fill={up ? "var(--color-met)" : "var(--color-missed)"} stroke="var(--color-sheet)" strokeWidth={2} />
      </svg>
    </figure>
  );
}

const SLICES = [
  { key: "concern", word: "Off track", color: "var(--color-missed)" },
  { key: "watch", word: "Watch", color: "var(--color-behind-mark)" },
  { key: "on_track", word: "On track", color: "var(--color-met)" },
] as const;

/** Off track / Watch / On track as a ring with a 2 px gap between segments; every slice also has its word and count. */
function StatusDonut({ counts }: { counts: { concern: number; watch: number; on_track: number } }) {
  const total = counts.concern + counts.watch + counts.on_track;
  const r = 38;
  const C = 2 * Math.PI * r;
  const gap = total > 1 ? 2.5 : 0;
  let offset = 0;
  return (
    <div className="flex items-center gap-5">
      <svg viewBox="0 0 100 100" className="h-24 w-24 shrink-0 -rotate-90" role="img" aria-label={SLICES.map((s) => `${counts[s.key]} ${s.word.toLowerCase()}`).join(", ")}>
        <circle cx="50" cy="50" r={r} fill="none" stroke="var(--color-ledger)" strokeWidth="12" />
        {total > 0 &&
          SLICES.map((s) => {
            const len = (counts[s.key] / total) * C;
            if (len === 0) return null;
            const el = <circle key={s.key} cx="50" cy="50" r={r} fill="none" stroke={s.color} strokeWidth="12" strokeDasharray={`${Math.max(0, len - gap)} ${C}`} strokeDashoffset={-offset} />;
            offset += len;
            return el;
          })}
        <text x="50" y="50" transform="rotate(90 50 50)" textAnchor="middle" dominantBaseline="central" className="fill-ink text-[20px] font-semibold">
          {total}
        </text>
      </svg>
      <ul className="min-w-0 space-y-1.5">
        {SLICES.map((s) => (
          <li key={s.key} className="flex items-center gap-2 text-body">
            <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ background: s.color }} />
            <span className="text-ink-2">{s.word}</span>
            <span className="text-num font-semibold text-ink">{counts[s.key]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PortfolioOverview({ counts }: { counts: { concern: number; watch: number; on_track: number } }) {
  const hist = useQuery(q.holdingsHistory());
  const [range, setRange] = useState<Range>("1M");
  const all = hist.data?.data.points ?? [];
  const n = SESSIONS[range];
  // The chart always shows at least a week, so "1D" still has a line to read.
  const window = Number.isFinite(n) ? all.slice(-(Math.max(n, 5) + 1)) : all;
  const from = Number.isFinite(n) ? all.at(-(n + 1)) : all[0];
  const to = all.at(-1);
  const change = from && to ? (to.index / from.index - 1) * 100 : null;

  return (
    <section aria-label="Portfolio overview" className="space-y-4 rounded-card border border-rule bg-sheet px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-caption font-medium text-ink-2">Portfolio value</p>
          {change !== null ? (
            <p className="flex items-baseline gap-2">
              <span className={`text-hero font-semibold ${change >= 0 ? "text-met" : "text-missed"}`}>
                {change >= 0 ? "+" : MINUS}
                {Math.abs(change).toFixed(2)}%
              </span>
              <span className="text-caption text-ink-3">{range === "All" && from ? `since ${istDate(`${from.date}T12:00:00+05:30`)}` : RANGE_WORD[range]}</span>
            </p>
          ) : (
            <p className="h-8 w-28 rounded-[4px] bg-ledger" aria-label="Loading" />
          )}
        </div>
        {to && from && range !== "1D" && (
          <span className="shrink-0 pt-1 text-caption">
            <span className="sr-only">Today: </span>
            <TrendPct value={all.length > 1 ? (to.index / all.at(-2)!.index - 1) * 100 : null} digits={2} /> <span className="text-ink-3">today</span>
          </span>
        )}
      </div>

      {window.length > 1 && <ValueLine points={window} />}
      <SegmentedControl label="Range" value={range} onChange={setRange} options={(Object.keys(SESSIONS) as Range[]).map((r) => ({ value: r, label: r }))} />

      <div className="border-t border-rule pt-4">
        <StatusDonut counts={counts} />
      </div>
    </section>
  );
}
