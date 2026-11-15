import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { CalendarDays, ChevronDown, ChevronRight, X } from "lucide-react";
import { ItemRow } from "../components/ItemRow";
import { SegmentedControl } from "../components/SegmentedControl";
import { Sheet } from "../components/Sheet";
import { istShortDay, shortName } from "../lib/format";
import { q, type BriefData, type Tier } from "../lib/queries";
import { readLocal, writeLocal } from "../lib/query";
import { carryWindow, WINDOW_LABEL, windowButtonLabel, windowFromParams, windowPhrase, type BriefWindow, type WindowKind } from "../lib/window";
import { ErrorLine, PageTitle, Skeleton } from "./parts";

const GUIDE_DISMISSED = "finn-guide-line-dismissed";
/** The page-length rule: at most six rows in a segment, then "See all". */
const CAP = 6;

const SEGMENTS: { value: Tier; label: string; noun: string }[] = [
  { value: "act", label: "Needs you", noun: "need you" },
  { value: "read", label: "Worth a look", noun: "worth a look" },
  { value: "routine", label: "Routine", noun: "routine" },
];

function useBriefParams() {
  const [params, setParams] = useSearchParams();
  const set = (patch: Record<string, string | null>, replace = false) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) v === null ? next.delete(k) : next.set(k, v);
    setParams(next, { replace });
  };
  return { params, set };
}

/** "3 to review" or "Nothing to review": the page's heading and its only large number. */
function HeroCount({ d }: { d: BriefData }) {
  const need = d.counts.act;
  return (
    <section aria-labelledby="hero" className="space-y-1">
      <PageTitle>
        <span id="hero">{need > 0 ? `${need} to review` : "Nothing to review"}</span>
      </PageTitle>
      {/* Only said when FINN had to look further back than the window you chose. */}
      {d.widened && d.message && <p className="text-caption text-ink-2">{d.message}</p>}
    </section>
  );
}

/** The window button and its sheet: since last visit, 24 h, 7 days, since last results, custom. */
function WindowPicker({ w, label, open, onOpen, onClose }: { w: BriefWindow; label: string; open: boolean; onOpen: () => void; onClose: () => void }) {
  const { set } = useBriefParams();
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const [from, setFrom] = useState(w.kind === "custom" && w.since ? new Date(w.since).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) : "");
  const [to, setTo] = useState(today);
  const choose = (k: WindowKind) => {
    if (k === "custom") return;
    set({ w: k === "results" ? null : k, from: null, to: null, seg: null, sheet: null }, true);
  };
  const applyCustom = (e: FormEvent) => {
    e.preventDefault();
    if (!from || from > to) return;
    set({ w: "custom", from, to, seg: null, sheet: null }, true);
  };
  return (
    <>
      <button
        type="button"
        onClick={onOpen}
        aria-haspopup="dialog"
        className="press inline-flex h-11 items-center gap-1.5 rounded-btn border border-rule bg-sheet pl-3 pr-2.5 text-caption font-medium text-ink hover:bg-ledger"
      >
        <span className="sr-only">Showing changes: </span>
        {label}
        <ChevronDown size={16} strokeWidth={1.75} aria-hidden="true" className="text-ink-3" />
      </button>
      {open && (
        <Sheet title="Show changes from" onClose={onClose}>
          <fieldset className="space-y-1">
            <legend className="sr-only">Time window</legend>
            {(Object.keys(WINDOW_LABEL) as WindowKind[]).map((k) => (
              <label key={k} className="press -mx-2 flex min-h-11 cursor-pointer items-center gap-3 rounded-btn px-2 hover:bg-ledger">
                <input type="radio" name="window" value={k} checked={w.kind === k} onChange={() => choose(k)} onClick={() => k !== "custom" && w.kind === k && onClose()} className="h-4 w-4 accent-royal" />
                <span className="text-body text-ink">{WINDOW_LABEL[k]}</span>
              </label>
            ))}
          </fieldset>
          <form onSubmit={applyCustom} className="mt-4 space-y-3 border-t border-rule pt-4">
            <p className="text-caption font-medium text-ink-2">Custom range</p>
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1 text-caption text-ink-3">
                From
                <input type="date" required value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="h-11 w-full rounded-btn border border-rule bg-sheet px-3 text-body text-ink" />
              </label>
              <label className="space-y-1 text-caption text-ink-3">
                To
                <input type="date" required value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} className="h-11 w-full rounded-btn border border-rule bg-sheet px-3 text-body text-ink" />
              </label>
            </div>
            <button type="submit" disabled={!from || from > to} className="press h-11 w-full rounded-btn bg-royal font-medium text-white disabled:opacity-50">
              Show this range
            </button>
          </form>
        </Sheet>
      )}
    </>
  );
}

/** One quiet ledger line for the next scheduled event; tap for the next five. */
function ComingUp({ items, open, onOpen, onClose }: { items: BriefData["coming_up"]; open: boolean; onOpen: () => void; onClose: () => void }) {
  const next = items[0];
  if (!next) return null;
  const what = (c: BriefData["coming_up"][number]) => (/result/i.test(c.label) ? "results" : "board meeting");
  return (
    <>
      <button type="button" onClick={onOpen} aria-haspopup="dialog" className="press flex min-h-11 w-full items-center gap-2.5 rounded-btn bg-ledger px-3 py-2 text-left hover:bg-rule/60">
        <CalendarDays size={17} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-ink-3" />
        <span className="min-w-0 flex-1 text-caption text-ink">
          Next: {shortName(next.name)} {what(next)}, {istShortDay(next.date)}
        </span>
        {items.length > 1 && <ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-ink-3" />}
      </button>
      {open && (
        <Sheet title="Coming up" subtitle="Board meetings your holdings have announced" onClose={onClose}>
          <ul className="divide-y divide-rule">
            {items.slice(0, 5).map((c) => (
              <li key={c.symbol} className="flex min-h-14 items-center justify-between gap-3 py-2">
                <span className="min-w-0">
                  <span className="block font-medium text-ink">{shortName(c.name)}</span>
                  <span className="block text-caption text-ink-2">{c.label}</span>
                </span>
                <span className="shrink-0 text-caption font-medium text-ink">{istShortDay(c.date)}</span>
              </li>
            ))}
          </ul>
        </Sheet>
      )}
    </>
  );
}

/** "18 routine filings: 12 investor meet notices, 2 debt servicing notes and 4 more." */
function routineLine(s: BriefData["routine_summary"]): string {
  const head = s.groups.slice(0, 3).map((g) => `${g.count} ${g.count === 1 ? g.label.replace(/s$/, "") : g.label}`);
  const rest = s.count - s.groups.slice(0, 3).reduce((n, g) => n + g.count, 0);
  const list = rest > 0 ? `${head.join(", ")} and ${rest} more` : head.length > 1 ? `${head.slice(0, -1).join(", ")} and ${head.at(-1)}` : head[0];
  return `${s.count} routine filing${s.count === 1 ? "" : "s"}${list ? `: ${list}` : ""}.`;
}

export function BriefPage() {
  const { params, set } = useBriefParams();
  const w = windowFromParams(params);
  const brief = useQuery(q.brief(w));
  const [showGuideLine, setShowGuideLine] = useState(() => readLocal(GUIDE_DISMISSED) !== "1");

  if (brief.isPending) return <Skeleton hero rows={3} />;
  if (brief.isError) return <ErrorLine message={brief.error.message} onRetry={() => brief.refetch()} />;
  const d = brief.data.data;

  // Default segment: Needs you; if it's empty, Worth a look. A segment you pick is kept in the
  // URL, so back and reload return to it.
  const asked = params.get("seg") as Tier | null;
  const seg: Tier = asked && asked in d.counts ? asked : d.counts.act > 0 ? "act" : d.counts.read > 0 ? "read" : "routine";
  const rows = (d.segments?.[seg] ?? []).slice(0, CAP);
  const segInfo = SEGMENTS.find((s) => s.value === seg)!;
  const sheet = params.get("sheet");
  const openSheet = (name: string) => set({ sheet: name });
  const closeSheet = () => set({ sheet: null }, true);
  const seeAll = `/list/brief-${seg}?${carryWindow(params)}`;

  return (
    <div className="space-y-6">
      {showGuideLine && (
        <p className="flex items-center justify-between gap-2 rounded-card bg-ledger py-1 pl-4 pr-1 text-caption text-ink-2">
          <span>
            New here?{" "}
            <Link to="?sheet=guide" className="font-medium text-royal underline-offset-4 hover:underline">
              See FINN in two minutes
            </Link>
          </span>
          <button
            type="button"
            aria-label="Dismiss the guide line"
            onClick={() => {
              setShowGuideLine(false);
              writeLocal(GUIDE_DISMISSED, "1");
            }}
            className="press grid h-11 w-11 shrink-0 place-items-center rounded-btn text-ink-3 hover:bg-sheet hover:text-ink"
          >
            <X size={18} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </p>
      )}

      <div className="space-y-3">
        <HeroCount d={d} />
        <WindowPicker key={w.kind + (w.since ?? "")} w={w} label={windowButtonLabel(w, d.window_used.from, d.window_used.to)} open={sheet === "window"} onOpen={() => openSheet("window")} onClose={closeSheet} />
      </div>

      <ComingUp items={d.coming_up} open={sheet === "coming-up"} onOpen={() => openSheet("coming-up")} onClose={closeSheet} />

      <section aria-label="What changed" className="space-y-3">
        <SegmentedControl
          label="What changed"
          value={seg}
          controls="brief-segment"
          onChange={(v) => set({ seg: v }, true)}
          options={SEGMENTS.map((s) => ({ value: s.value, label: s.label, count: d.counts[s.value] }))}
        />
        <div id="brief-segment" role="tabpanel" aria-label={segInfo.label}>
          {seg === "routine" && d.routine_summary.count > 0 && <p className="pb-2 text-caption text-ink-2">{routineLine(d.routine_summary)}</p>}
          {rows.length === 0 ? (
            <p className="py-3 text-body text-ink-2">{seg === "act" ? `Nothing needs attention ${windowPhrase(w, d.window_used.from)}.` : `Nothing ${segInfo.noun} in this window.`}</p>
          ) : (
            <ul className="space-y-2.5">
              {rows.map((i) => (
                <li key={i.filing_id}>
                  <ItemRow item={i} />
                </li>
              ))}
            </ul>
          )}
          {d.counts[seg] > rows.length && (
            <Link to={seeAll} className="press mt-2.5 flex min-h-11 items-center justify-between rounded-btn px-1 font-medium text-royal hover:bg-sheet">
              See all {d.counts[seg]} {segInfo.noun === "need you" ? "that need you" : segInfo.noun}
              <ChevronRight size={18} strokeWidth={1.75} aria-hidden="true" />
            </Link>
          )}
        </div>
      </section>
    </div>
  );
}
