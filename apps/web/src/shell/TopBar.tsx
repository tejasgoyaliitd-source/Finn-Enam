import { useLayoutEffect, useRef } from "react";
import { ChevronLeft, CircleHelp, Settings } from "lucide-react";
import { istDateTime } from "../lib/format";

export interface FreshnessView {
  /** IST timestamp of the data on screen. */
  asOf: string | null;
  stale: boolean;
  staleReason: string | null;
  /** Browser is offline and this is cached data loaded at loadedAt. */
  offline: boolean;
  loadedAt: number | null;
  loading: boolean;
  error: string | null;
}

/** "Updated 15:05" today, "Updated 14 Nov, 19:30" otherwise. Always an absolute time. */
function updatedLabel(iso: string): string {
  const full = istDateTime(iso);
  const today = istDateTime(Date.now()).split(", ")[0];
  return full.startsWith(`${today},`) ? full.split(", ")[1]! : full;
}

/** A dot and a time: green when fresh, amber when stale or offline. The reason is in the title and for screen readers. */
function Updated({ f }: { f: FreshnessView }) {
  if (f.loading) return <span className="block h-3 w-24 rounded-[4px] bg-ledger" aria-label="Loading" />;
  const warn = f.offline || f.stale || (!!f.error && !f.asOf);
  const text = f.offline ? "Offline" : f.asOf ? `Updated ${updatedLabel(f.asOf)}` : f.error ? "Can't reach FINN" : null;
  if (!text) return null;
  const why = f.offline ? `Showing what was loaded${f.loadedAt ? ` at ${istDateTime(f.loadedAt).split(", ")[1]}` : ""}` : f.stale ? (f.staleReason ?? "Data is older than it should be") : f.error;
  return (
    <span className={`flex items-center gap-1.5 whitespace-nowrap text-caption ${warn ? "font-medium text-behind-text" : "text-ink-3"}`} title={why ?? undefined}>
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-pill ${warn ? "bg-behind-mark" : "bg-met"}`} />
      {text}
      {why && <span className="sr-only">. {why}</span>}
    </span>
  );
}

const iconButton = "press grid h-11 w-11 place-items-center rounded-btn text-ink-2 hover:bg-ledger hover:text-ink";

/** The F mark and wordmark: the app's one logo, drawn in type. */
export function Logo() {
  return (
    <span className="flex items-center gap-2" aria-label="FINN">
      <span aria-hidden="true" className="grid h-7 w-7 place-items-center rounded-[7px] bg-ink text-[15px] font-semibold leading-none text-white">
        F
      </span>
      <span aria-hidden="true" className="text-[17px] font-semibold tracking-[0.06em] text-ink">
        FINN
      </span>
    </span>
  );
}

/**
 * The slim sticky bar: logo (or back link) on the left; freshness, guide and settings on the right.
 * The page's own title sits below, in the page, so this bar stays one line on every screen.
 */
export function TopBar({
  freshness,
  back,
  onGuide,
  onSettings,
}: {
  freshness: FreshnessView;
  /** Company and list pages: a back link to the tab you came from. */
  back?: { label: string; onBack: () => void };
  onGuide: () => void;
  onSettings: () => void;
}) {
  // Sticky things below the bar (company tabs) sit at its live height: --topbar-h.
  const headerRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const set = () => document.documentElement.style.setProperty("--topbar-h", `${el.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <header ref={headerRef} className="sticky top-0 z-20 bg-paper/95 backdrop-blur-sm" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      <div className="mx-auto flex h-14 w-full max-w-[640px] items-center justify-between gap-2 px-4 sm:px-6">
        {back ? (
          <button type="button" onClick={back.onBack} className="press -ml-2 flex h-11 min-w-0 items-center gap-0.5 rounded-btn pl-1 pr-3 text-body font-medium text-royal hover:bg-ledger">
            <ChevronLeft size={20} strokeWidth={1.75} aria-hidden="true" />
            <span className="truncate">{back.label}</span>
          </button>
        ) : (
          <Logo />
        )}
        <div className="flex min-w-0 items-center gap-0.5">
          <Updated f={freshness} />
          <button type="button" onClick={onGuide} aria-label="Reviewer guide: FINN in two minutes" className={`${iconButton} ml-1`}>
            <CircleHelp size={20} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <button type="button" onClick={onSettings} aria-label="Settings" className={`${iconButton} -mr-2`}>
            <Settings size={20} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
      </div>
    </header>
  );
}
