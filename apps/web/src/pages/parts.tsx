import type { ReactNode } from "react";

/** Skeleton rows: the first-load state. No spinner, no "Loading…" copy. */
export function Skeleton({ rows = 3, hero = false }: { rows?: number; hero?: boolean }) {
  return (
    <div aria-busy="true" aria-label="Loading" className="space-y-5">
      {hero && <div className="h-8 w-24 rounded-[4px] bg-ledger" />}
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="space-y-2">
          <div className="h-4 w-3/4 rounded-[4px] bg-ledger" />
          <div className="h-3 w-1/2 rounded-[4px] bg-ledger" />
        </div>
      ))}
    </div>
  );
}

/** Errors say what happened and what to do, without apologising. */
export function ErrorLine({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="space-y-3">
      <p className="text-body text-ink-2">{message}</p>
      <button type="button" onClick={onRetry} className="press h-11 rounded-btn border border-rule bg-sheet px-4 font-medium text-royal hover:bg-ledger">
        Try again
      </button>
    </div>
  );
}

export function SectionTitle({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h2 id={id} className="text-section font-semibold text-ink">
      {children}
    </h2>
  );
}

/** List rows: no card chrome, separated by space and a hairline, 56 px minimum. */
export const rowClass = "press -mx-2 flex min-h-14 flex-col justify-center rounded-btn px-2 py-3 hover:bg-sheet";

/** The one card: white, hairline border, 12 px corners. Every tile in the app uses it. */
export const cardClass = "rounded-card border border-rule bg-sheet";

/** A page's title row: the big heading, and an action on the right if the page has one. */
export function PageTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-3 pb-1">
      <h1 className="min-w-0 text-hero font-semibold tracking-[-0.01em] text-ink">{children}</h1>
      {action}
    </div>
  );
}

export type Tone = "missed" | "behind" | "met" | "quiet";
const PILL: Record<Tone, string> = {
  missed: "bg-missed-tint text-missed",
  behind: "bg-behind-tint text-behind-text",
  met: "bg-met-tint text-met",
  quiet: "bg-ledger text-ink-2",
};
/** A status word on a pale tint: the word carries the meaning, the colour only repeats it. */
export function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-[6px] px-1.5 py-0.5 text-[12px] font-medium leading-4 ${PILL[tone]}`}>{children}</span>;
}

/** Holding states in plain words: the API says Concern; people say off track. */
export const STATE_WORD = { Concern: "Off track", Watch: "Watch", "On track": "On track" } as const;
export const STATE_TONE = { Concern: "missed", Watch: "behind", "On track": "met" } as const;
