import type { HoldingState } from "../lib/queries";

/**
 * Status colours never appear alone: every status is a glyph, a word and a colour.
 * The glyph shape carries the meaning for colour-blind readers; the word for everyone.
 */
const STATE: Record<HoldingState, { glyph: string; word: string; text: string; mark: string }> = {
  Concern: { glyph: "✕", word: "Concern", text: "text-missed", mark: "text-missed" },
  Watch: { glyph: "!", word: "Watch", text: "text-behind-text", mark: "text-behind-mark" },
  "On track": { glyph: "✓", word: "On track", text: "text-met", mark: "text-met" },
};

export function StateWord({ state }: { state: HoldingState }) {
  const s = STATE[state];
  return (
    <span className={`inline-flex items-baseline gap-1 text-caption font-medium ${s.text}`}>
      <span aria-hidden="true" className={`font-semibold ${s.mark}`}>
        {s.glyph}
      </span>
      {s.word}
    </span>
  );
}

/** "✕ 2 concern  ! 7 watch  ✓ 9 on track": text with glyphs, no tiles, no donut. */
export function StateSummary({ counts }: { counts: { concern: number; watch: number; on_track: number } }) {
  const parts: [HoldingState, number][] = [
    ["Concern", counts.concern],
    ["Watch", counts.watch],
    ["On track", counts.on_track],
  ];
  return (
    <p className="flex flex-wrap gap-x-4 gap-y-1 text-body">
      {parts.map(([state, n]) => (
        <span key={state} className={`inline-flex items-baseline gap-1.5 ${STATE[state].text}`}>
          <span aria-hidden="true" className={`font-semibold ${STATE[state].mark}`}>
            {STATE[state].glyph}
          </span>
          <span className="font-semibold">{n}</span>
          <span>{state === "On track" ? "on track" : state.toLowerCase()}</span>
        </span>
      ))}
    </p>
  );
}
