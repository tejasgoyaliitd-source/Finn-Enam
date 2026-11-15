import { MINUS } from "../lib/format";

interface TrendPctProps {
  value: number | null | undefined;
  digits?: number;
  suffix?: string;
  isBps?: boolean;
  className?: string;
  showPlus?: boolean;
}

/**
 * Renders price, volume, margin and financial metric movements with
 * strict green/red coloring and intuitive up/down arrows.
 * Up/Increase: green with ↑
 * Down/Decrease: red with ↓
 */
export function TrendPct({
  value,
  digits = 1,
  suffix = "%",
  isBps = false,
  className = "",
  showPlus = true,
}: TrendPctProps) {
  if (value == null) return <span className="text-ink-3">−</span>;
  if (value === 0) return <span className={`text-ink-2 tabular-nums ${className}`}>0{suffix}</span>;

  const isUp = value > 0;
  const arrow = isUp ? "↑" : "↓";
  const sign = isUp ? (showPlus ? "+" : "") : MINUS;
  const abs = Math.abs(value);
  const formattedNum = abs.toLocaleString("en-IN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

  const label = isBps
    ? `${arrow} ${isUp ? "+" : MINUS}${Math.round(abs)} bps`
    : `${arrow} ${sign}${formattedNum}${suffix}`;

  // Theme tokens only: the app resets Tailwind's palette, so emerald/rose classes render nothing.
  const colorClass = isUp ? "text-met" : "text-missed";

  return (
    <span
      className={`inline-flex items-center gap-0.5 font-medium tabular-nums ${colorClass} ${className}`}
      aria-label={`${isUp ? "Increased" : "Decreased"} by ${formattedNum}${suffix}`}
    >
      <span>{label}</span>
    </span>
  );
}
