import { useId, useState } from "react";
import { MINUS, num } from "../lib/format";

/**
 * Charts follow one method: one series, one axis, thin marks, a recessive baseline, direct labels
 * on the first and last value only, a hover read-out for every mark, and a table beside each.
 * Colour: royal for the series (validated ≥ 3:1 on the sheet), ink tokens for every word.
 */

/** 60-session price line: ink-2 1.5 px, a dot on the last close. No axis, no legend. */
export function Sparkline({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return null;
  const w = 120;
  const h = 32;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const x = (i: number) => (i / (values.length - 1)) * (w - 4) + 2;
  const y = (v: number) => (max === min ? h / 2 : h - 3 - ((v - min) / (max - min)) * (h - 6));
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label={label} className="shrink-0 overflow-visible">
      <path d={d} fill="none" stroke="var(--color-ink-2)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(values.length - 1)} cy={y(values.at(-1)!)} r={2.5} fill="var(--color-ink)" />
    </svg>
  );
}

const fmtX = (v: number) => `${v < 0 ? MINUS : ""}${Math.abs(v).toFixed(2)}×`;

/**
 * Cash conversion: CFO ÷ PAT by year as thin bars, with a dashed 1.0× line (cash matched profit).
 * Values above 1 mean profit came in as cash.
 */
export function CashBars({ rows }: { rows: { fy: string; cfo: number | null; pat: number | null; ratio: number | null }[] }) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const data = rows.filter((r) => r.ratio !== null) as { fy: string; cfo: number; pat: number; ratio: number }[];
  if (data.length === 0) return <p className="text-caption text-ink-3">No cash flow figures on file.</p>;
  const W = 320;
  const H = 150;
  const top = 18;
  const bottom = 34;
  const lo = Math.min(0, ...data.map((d) => d.ratio));
  const hi = Math.max(1.2, ...data.map((d) => d.ratio));
  const y = (v: number) => top + (1 - (v - lo) / (hi - lo)) * (H - top - bottom);
  const slot = W / data.length;
  const bw = Math.min(28, slot - 8);
  const shown = hover ?? data.length - 1;
  return (
    <figure className="space-y-2">
      <div className="flex items-baseline justify-between text-caption">
        <span className="text-ink-2">Operating cash flow ÷ profit</span>
        <span className="text-ink" aria-live="polite">
          {data[shown]!.fy}: <span className="text-num font-semibold">{fmtX(data[shown]!.ratio)}</span>
          <span className="text-ink-3">
            {" "}
            (₹{num(data[shown]!.cfo)} cr ÷ ₹{num(data[shown]!.pat)} cr)
          </span>
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-labelledby={`${id}-t`} onPointerLeave={() => setHover(null)}>
        <title id={`${id}-t`}>{`Cash conversion by year: ${data.map((d) => `${d.fy} ${fmtX(d.ratio)}`).join(", ")}`}</title>
        <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke="var(--color-rule)" />
        {data.map((d, i) => {
          const cx = slot * i + slot / 2;
          const y0 = y(0);
          const y1 = y(d.ratio);
          const hgt = Math.max(1, Math.abs(y0 - y1));
          return (
            <g key={d.fy} onPointerEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0} aria-label={`${d.fy}: ${fmtX(d.ratio)}`}>
              <rect x={cx - slot / 2} y={top - 10} width={slot} height={H - top} fill="transparent" />
              <rect x={cx - bw / 2} y={Math.min(y0, y1)} width={bw} height={hgt} rx={4} fill="var(--color-royal)" opacity={hover === null || hover === i ? 1 : 0.45} />
              <text x={cx} y={H - 6} textAnchor="middle" fontSize={11} fill="var(--color-ink-3)">
                {d.fy}
              </text>
              {(i === 0 || i === data.length - 1) && (
                // Above a positive bar, below a negative one.
                <text x={cx} y={d.ratio >= 0 ? y1 - 5 : y1 + 13} textAnchor="middle" fontSize={11} fill="var(--color-ink)" className="text-num">
                  {fmtX(d.ratio)}
                </text>
              )}
            </g>
          );
        })}
        <line x1={0} x2={W} y1={y(1)} y2={y(1)} stroke="var(--color-ink-2)" strokeDasharray="4 3" strokeWidth={1} />
      </svg>
      {/* The reference line's key sits outside the plot, so it never collides with a bar. */}
      <p className="flex items-center gap-2 text-caption text-ink-2">
        <svg width="20" height="2" aria-hidden="true">
          <line x1="0" x2="20" y1="1" y2="1" stroke="var(--color-ink-2)" strokeDasharray="4 3" />
        </svg>
        1.0× = cash matched profit
      </p>
    </figure>
  );
}

/** One small multiple: a single measure over years, its own axis, first and last labelled. */
export function MiniLine({ title, unit, points }: { title: string; unit: "cr" | "pct"; points: { fy: string; v: number | null }[] }) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const data = points.filter((p) => p.v !== null) as { fy: string; v: number }[];
  const fmt = (v: number) => (unit === "pct" ? `${v < 0 ? MINUS : ""}${Math.abs(v).toFixed(1)}%` : `₹${num(v)} cr`);
  if (data.length < 2) return (
    <div className="space-y-1">
      <p className="text-caption font-medium text-ink-2">{title}</p>
      <p className="text-caption text-ink-3">Not enough years on file.</p>
    </div>
  );
  const W = 320;
  const H = 84;
  const pad = 8;
  const min = Math.min(...data.map((d) => d.v));
  const max = Math.max(...data.map((d) => d.v));
  const lo = unit === "cr" ? Math.min(0, min) : min - (max - min || 1) * 0.15;
  const hi = max + (max - lo || 1) * 0.15;
  const x = (i: number) => pad + (i / (data.length - 1)) * (W - pad * 2);
  const y = (v: number) => 16 + (1 - (v - lo) / (hi - lo)) * (H - 32);
  const d = data.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.v)}`).join("");
  const shown = hover ?? data.length - 1;
  return (
    <figure className="space-y-1">
      <figcaption className="flex items-baseline justify-between text-caption">
        <span className="font-medium text-ink-2">{title}</span>
        <span className="text-ink" aria-live="polite">
          {data[shown]!.fy}: <span className="text-num font-semibold">{fmt(data[shown]!.v)}</span>
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-labelledby={`${id}-t`} onPointerLeave={() => setHover(null)}>
        <title id={`${id}-t`}>{`${title}: ${data.map((p) => `${p.fy} ${fmt(p.v)}`).join(", ")}`}</title>
        <line x1={0} x2={W} y1={H - 14} y2={H - 14} stroke="var(--color-rule)" />
        <path d={d} fill="none" stroke="var(--color-royal)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {data.map((p, i) => (
          <g key={p.fy} onPointerEnter={() => setHover(i)}>
            <rect x={x(i) - (W / data.length) / 2} y={0} width={W / data.length} height={H} fill="transparent" />
            <circle cx={x(i)} cy={y(p.v)} r={hover === i ? 4.5 : 3} fill="var(--color-royal)" stroke="var(--color-sheet)" strokeWidth={2} />
          </g>
        ))}
        <text x={pad} y={H - 2} fontSize={11} fill="var(--color-ink-3)">
          {data[0]!.fy}
        </text>
        <text x={W - pad} y={H - 2} fontSize={11} textAnchor="end" fill="var(--color-ink-3)">
          {data.at(-1)!.fy}
        </text>
        <text x={x(0)} y={y(data[0]!.v) - 7} fontSize={11} fill="var(--color-ink)">
          {fmt(data[0]!.v)}
        </text>
        <text x={x(data.length - 1)} y={y(data.at(-1)!.v) - 7} fontSize={11} textAnchor="end" fill="var(--color-ink)">
          {fmt(data.at(-1)!.v)}
        </text>
      </svg>
    </figure>
  );
}
