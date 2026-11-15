import type { JobData } from "../lib/queries";

/**
 * Research progress in sentences: ✓ done (with what it found), … running, ○ waiting,
 * – skipped (with why), ✕ failed (with why). Read out politely as it changes.
 */
const MARK: Record<JobData["steps"][number]["state"], { glyph: string; tone: string; word: string }> = {
  done: { glyph: "✓", tone: "text-met", word: "Done" },
  running: { glyph: "…", tone: "text-royal", word: "Now" },
  pending: { glyph: "○", tone: "text-ink-3", word: "Next" },
  skipped: { glyph: "–", tone: "text-ink-3", word: "Skipped" },
  failed: { glyph: "✕", tone: "text-missed", word: "Failed" },
};

export function JobSteps({ job }: { job: JobData }) {
  return (
    <ol className="space-y-1.5" aria-live="polite">
      {job.steps.map((s, i) => {
        const m = MARK[s.state];
        // Done steps say what they found; the others say what they are doing.
        const text = s.state === "done" && s.note ? s.note : s.label;
        return (
          <li key={i} className="flex gap-2.5 text-body">
            <span aria-hidden="true" className={`w-4 shrink-0 text-center font-semibold ${m.tone} ${s.state === "running" ? "animate-pulse" : ""}`}>
              {m.glyph}
            </span>
            <span className={s.state === "pending" ? "text-ink-3" : "text-ink"}>
              <span className="sr-only">{m.word}: </span>
              {text}
              {(s.state === "skipped" || s.state === "failed") && s.note && <span className="block text-caption text-ink-3">{s.note}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
