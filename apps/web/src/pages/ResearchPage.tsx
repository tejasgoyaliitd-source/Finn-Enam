import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router";
import { ChevronRight, Search } from "lucide-react";
import { shortName } from "../lib/format";
import { q } from "../lib/queries";
import { readLocal, writeLocal } from "../lib/query";
import { cardClass, PageTitle, Skeleton } from "./parts";

const RECENT = "finn-research-recent";
/** Ready-to-read rows shown before "See all". */
const CAP = 6;

const recentList = (): string[] => {
  try {
    return JSON.parse(readLocal(RECENT) ?? "[]") as string[];
  } catch {
    return [];
  }
};

/** Opening a company from Research: ?read=1 tells the company page to start reading if it hasn't. */
export const researchHref = (symbol: string) => `/c/${encodeURIComponent(symbol)}?read=1`;

export function ResearchPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [term, setTerm] = useState("");
  const [active, setActive] = useState(-1);
  const [showAll, setShowAll] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const t = term.trim();
  const search = useQuery(q.search(t));
  const list = useQuery(q.researchList());
  const [recent, setRecent] = useState(recentList);

  useEffect(() => {
    if (params.get("focus") === "search") input.current?.focus();
  }, [params]);
  useEffect(() => setActive(-1), [t]);

  const open = (symbol: string) => {
    const next = [symbol, ...recent.filter((x) => x !== symbol)].slice(0, 5);
    setRecent(next);
    writeLocal(RECENT, JSON.stringify(next));
    navigate(researchHref(symbol));
  };
  const matches = t ? (search.data?.data.items ?? []) : [];
  const onKey = (e: React.KeyboardEvent) => {
    if (!matches.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (e.key === "ArrowDown" ? Math.min(matches.length - 1, i + 1) : Math.max(0, i - 1)));
    } else if (e.key === "Enter") {
      e.preventDefault();
      open(matches[Math.max(0, active)]!.symbol);
    }
  };

  const d = list.data?.data;
  const ready = d ? (showAll ? d.ready : d.ready.slice(0, CAP)) : [];

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <PageTitle>Research</PageTitle>
        <div className="relative">
          <Search size={18} strokeWidth={1.75} aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3" />
          <input
            ref={input}
            type="search"
            role="combobox"
            aria-label="Company name or NSE symbol"
            aria-expanded={matches.length > 0}
            aria-controls="search-results"
            aria-activedescendant={active >= 0 ? `match-${active}` : undefined}
            autoComplete="off"
            spellCheck={false}
            value={term}
            onChange={(e) => setTerm(e.target.value.replace(/[^A-Za-z0-9 &-]/g, ""))}
            onKeyDown={onKey}
            placeholder="Any NSE company or symbol"
            className="h-12 w-full rounded-btn border border-rule bg-sheet pl-10 pr-4 text-body text-ink placeholder:text-ink-3 focus:border-royal"
          />
        </div>
        {search.isError && t && <p className="text-caption text-behind-text">{search.error.message}</p>}
        {t && search.data && (
          <ul id="search-results" role="listbox" aria-label="Matches" className="divide-y divide-rule rounded-card border border-rule bg-sheet">
            {matches.length === 0 && <li className="px-4 py-3 text-ink-2">No NSE company matches “{t}”.</li>}
            {matches.map((c, i) => (
              <li key={c.symbol} id={`match-${i}`} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  onClick={() => open(c.symbol)}
                  className={`press flex min-h-12 w-full items-center justify-between gap-3 px-4 py-2 text-left hover:bg-ledger ${i === active ? "bg-ledger" : ""}`}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-ink">{shortName(c.name)}</span>
                    <span className="block text-caption text-ink-3">{c.symbol}</span>
                  </span>
                  <ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-ink-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {!t && (
        <>
          <section aria-labelledby="ready" className="space-y-2">
            <h2 id="ready" className="px-1 text-caption font-semibold text-ink-2">
              Recently read
            </h2>
            {list.isPending && <Skeleton rows={2} />}
            {d && d.ready.length === 0 && <p className="px-1 text-body text-ink-2">Nothing read yet. Search a company to start.</p>}
            {ready.length > 0 && (
              <ul className={`${cardClass} divide-y divide-rule`}>
                {ready.map((r) => (
                  <li key={r.symbol}>
                    <Link to={`/c/${r.symbol}`} className="press flex min-h-14 items-center justify-between gap-3 px-4 py-3 text-left hover:bg-paper">
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-ink">{shortName(r.name)}</span>
                        <span className="block truncate text-caption text-ink-2">
                          {r.statements > 0 ? `${r.statements} promises. ${r.credibility}` : r.held ? "In your holdings" : "No promises read yet"}
                        </span>
                      </span>
                      <span className="shrink-0 text-caption font-medium text-ink-3">{r.symbol}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {d && d.ready.length > CAP && (
              <button type="button" onClick={() => setShowAll((x) => !x)} className="press flex min-h-11 items-center rounded-btn px-1 font-medium text-royal hover:bg-sheet">
                {showAll ? "Show fewer" : `See all ${d.ready.length}`}
              </button>
            )}
          </section>

          {d && d.suggestions.length > 0 && (
            <section aria-labelledby="try" className="space-y-2">
              <h2 id="try" className="px-1 text-caption font-semibold text-ink-2">
                Try one you don't hold
              </h2>
              <div className="flex flex-wrap gap-2">
                {d.suggestions.map((s) => (
                  <button key={s.symbol} type="button" onClick={() => open(s.symbol)} className="press inline-flex min-h-11 items-center rounded-pill border border-rule bg-sheet px-4 font-medium text-ink hover:bg-ledger">
                    {shortName(s.name)}
                  </button>
                ))}
              </div>
            </section>
          )}

        </>
      )}
    </div>
  );
}
