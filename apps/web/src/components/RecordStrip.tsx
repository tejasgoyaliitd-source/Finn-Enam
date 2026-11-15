import type { RecordStripData, VerdictCode } from "../lib/queries";

/**
 * The record strip: one glyph per management target, oldest first. The glyph's shape carries the
 * meaning (✓ met, ✕ missed, ↻ revised, ◷ too early, ! behind, – not measurable); colour only
 * repeats it. Screen readers get the whole sentence instead of the glyphs.
 */
const TONE: Record<VerdictCode, string> = {
  met: "text-met",
  missed: "text-missed",
  behind: "text-behind-mark",
  revised: "text-ink-2",
  too_early: "text-ink-3",
  not_measurable: "text-ink-3",
  not_mentioned_since: "text-ink-3",
};

export function RecordStrip({ record, withLine = false, animate = false }: { record: RecordStripData | null; withLine?: boolean; animate?: boolean }) {
  if (!record) return null;
  return (
    <span className="inline-flex items-baseline gap-2" role="img" aria-label={record.label}>
      <span aria-hidden="true" className={`inline-flex gap-[3px] text-caption font-semibold leading-none tracking-normal ${animate ? "strip-in" : ""}`}>
        {record.marks.map((m, i) => (
          <span key={i} style={{ ["--i" as string]: i }} className={`inline-block w-[0.9em] text-center ${TONE[m.verdict]}`}>
            {m.glyph}
          </span>
        ))}
      </span>
      {withLine && (
        <span aria-hidden="true" className="text-caption text-ink-2">
          {record.line}
        </span>
      )}
    </span>
  );
}
