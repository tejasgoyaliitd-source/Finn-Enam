import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router";

import { q, type Tier } from "../lib/queries";
import { windowFromParams, windowSubline } from "../lib/window";
import { ItemRow } from "../components/ItemRow";
import { ErrorLine, PageTitle, Skeleton } from "./parts";

export const LIST_KINDS: Record<string, { tier: Tier; title: string }> = {
  "brief-act": { tier: "act", title: "Needs you" },
  "brief-read": { tier: "read", title: "Worth a look" },
  "brief-routine": { tier: "routine", title: "Routine" },
  // Older links.
  act: { tier: "act", title: "Needs you" },
  read: { tier: "read", title: "Worth a look" },
  routine: { tier: "routine", title: "Routine" },
};

const CATEGORY_WORD: Record<string, string> = { m_and_a: "M&A", esop: "ESOP", agm: "AGM" };
export const categoryLabel = (c: string) => CATEGORY_WORD[c] ?? c.charAt(0).toUpperCase() + c.slice(1).replace(/_/g, " ");

/** "See all" for a Brief segment: filters (category, company) and plain paging, never an endless feed. */
export function ListPage() {
  const { kind = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const spec = LIST_KINDS[kind];
  const w = windowFromParams(params);
  const category = params.get("category");
  const symbol = params.get("symbol");
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const cursor = cursors.at(-1) ?? null;
  const list = useQuery({ ...q.briefList(spec?.tier ?? "read", cursor, w, { category, symbol }), enabled: !!spec });
  if (!spec) return <NotFound />;
  const setFilter = (k: "category" | "symbol", v: string) => {
    const next = new URLSearchParams(params);
    v ? next.set(k, v) : next.delete(k);
    setCursors([null]);
    setParams(next, { replace: true });
  };
  const d = list.data?.data;
  const page = cursors.length;
  // A new page starts at its top, like turning a page.
  const turn = (fn: () => void) => {
    fn();
    window.scrollTo({ top: 0 });
  };
  const select = "h-11 w-full min-w-0 rounded-btn border border-rule bg-sheet px-3 text-caption text-ink";
  return (
    <div className="space-y-4">
      <PageTitle>{spec.title}</PageTitle>
      {d && (
        <p className="text-caption text-ink-3">
          {d.total} {d.total === 1 ? "item" : "items"}. {windowSubline(w, d.window_used.from, d.window_used.to)}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1 text-caption text-ink-3">
          Category
          <select value={category ?? ""} onChange={(e) => setFilter("category", e.target.value)} className={select}>
            <option value="">All categories</option>
            {d?.facets.categories.map((c) => (
              <option key={c} value={c}>
                {categoryLabel(c)}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-caption text-ink-3">
          Company
          <select value={symbol ?? ""} onChange={(e) => setFilter("symbol", e.target.value)} className={select}>
            <option value="">All companies</option>
            {d?.facets.symbols.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>
      {list.isPending && <Skeleton rows={4} />}
      {list.isError && <ErrorLine message={list.error.message} onRetry={() => list.refetch()} />}
      {d && (
        <>
          {d.items.length === 0 ? (
            <p className="py-3 text-body text-ink-2">Nothing matches these filters in this window.</p>
          ) : (
            <ul className="space-y-2.5" aria-busy={list.isFetching}>
              {d.items.map((i) => (
                <li key={i.filing_id}>
                  <ItemRow item={i} showDate />
                </li>
              ))}
            </ul>
          )}
          {(page > 1 || d.next_cursor) && (
            <nav aria-label="Pages" className="flex items-center justify-between gap-2">
              <button type="button" disabled={page === 1} onClick={() => turn(() => setCursors((c) => c.slice(0, -1)))} className="press h-11 rounded-btn border border-rule bg-sheet px-4 font-medium text-royal hover:bg-ledger disabled:invisible">
                Previous 20
              </button>
              <span className="text-caption text-ink-3">
                {(page - 1) * 20 + 1}–{(page - 1) * 20 + d.items.length} of {d.total}
              </span>
              <button type="button" disabled={!d.next_cursor} onClick={() => turn(() => setCursors((c) => [...c, d.next_cursor]))} className="press h-11 rounded-btn border border-rule bg-sheet px-4 font-medium text-royal hover:bg-ledger disabled:invisible">
                Next 20
              </button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}

export function NotFound() {
  return (
    <div className="space-y-3">
      <p className="text-body text-ink-2">There is no page at this address.</p>
      <Link to="/brief" className="press inline-flex h-11 items-center rounded-btn border border-rule bg-sheet px-4 font-medium text-royal hover:bg-ledger">
        Go to Brief
      </Link>
    </div>
  );
}
