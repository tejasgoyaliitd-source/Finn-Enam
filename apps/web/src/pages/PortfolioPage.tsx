import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { PortfolioOverview } from "../components/PortfolioOverview";
import { SegmentedControl } from "../components/SegmentedControl";
import { HoldingsTable } from "../components/HoldingsTable";
import { Sheet } from "../components/Sheet";
import { api } from "../lib/api";
import { num } from "../lib/format";
import { bustCache, q, type Holding, type HoldingState, type SaveHoldingsData } from "../lib/queries";
import { ErrorLine, PageTitle, Skeleton } from "./parts";

type Filter = "all" | "concern" | "watch" | "on_track";
const STATE_OF: Record<Exclude<Filter, "all">, HoldingState> = { concern: "Concern", watch: "Watch", on_track: "On track" };

interface Draft {
  key: number;
  symbol: string;
  weight: string;
}

/** Paste or edit symbols and weights. The API checks them, and the mandate, before saving. */
function EditHoldings({ holdings, onClose }: { holdings: Holding[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [rows, setRows] = useState<Draft[]>(() => holdings.map((h, i) => ({ key: i, symbol: h.symbol, weight: String(h.weight_pct) })));
  const [nextKey, setNextKey] = useState(holdings.length);
  const total = rows.reduce((n, r) => n + (Number(r.weight) || 0), 0);
  const set = (key: number, patch: Partial<Draft>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const save = useMutation({
    mutationFn: () =>
      api<SaveHoldingsData>("/v1/holdings", {
        method: "PUT",
        body: JSON.stringify({ holdings: rows.filter((r) => r.symbol.trim()).map((r) => ({ symbol: r.symbol.trim().toUpperCase(), weight_pct: Number(r.weight) })) }),
      }),
    onSuccess: () => {
      bustCache();
      // Everything that depends on the holdings: states, the brief, alerts, company headers.
      for (const k of ["holdings", "brief", "brief-list", "alerts", "company"]) void qc.invalidateQueries({ queryKey: [k] });
    },
  });
  const done = save.data?.data;
  const field = "h-11 min-w-0 rounded-btn border border-rule bg-sheet px-3 text-body text-ink focus:border-royal";

  return (
    <Sheet
      title="Edit holdings"
      subtitle="NSE symbols and portfolio weights. Checked against your exclusions on save."
      onClose={onClose}
      tall
      footer={
        done ? (
          <button type="button" onClick={onClose} className="press h-11 w-full rounded-btn bg-royal font-medium text-white">
            Done
          </button>
        ) : (
          <div className="space-y-2">
            {save.isError && (
              <p className="text-caption text-missed" role="alert">
                <span aria-hidden="true" className="font-semibold">
                  ✕{" "}
                </span>
                Not saved. {save.error.message}
              </p>
            )}
            <div className="flex items-center justify-between gap-3">
              <p className={`text-caption ${total > 100.01 ? "font-medium text-missed" : "text-ink-2"}`}>
                Total <span className="text-num font-medium">{num(total, 2)}%</span>
                {total > 100.01 ? ", above 100%" : total < 99.99 ? `, ${num(100 - total, 2)}% cash` : ""}
              </p>
              <button type="button" onClick={() => save.mutate()} disabled={save.isPending || total > 100.01} className="press h-11 rounded-btn bg-royal px-5 font-medium text-white disabled:opacity-50">
                {save.isPending ? "Checking" : "Save"}
              </button>
            </div>
          </div>
        )
      }
    >
      {done ? (
        <div className="space-y-3" role="status">
          <p className="text-body text-ink">
            <span aria-hidden="true" className="font-semibold text-met">
              ✓{" "}
            </span>
            Saved {done.saved} holdings, {num(done.total_pct, 2)}% invested.
          </p>
          <p className={`text-body ${done.mandate.status === "outside" ? "text-missed" : "text-ink"}`}>{done.mandate.line}</p>
          {done.warnings.map((w) => (
            <p key={w} className="text-caption text-behind-text">
              <span aria-hidden="true" className="font-semibold text-behind-mark">
                !{" "}
              </span>
              {w}
            </p>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_6.5rem_2.75rem] gap-2 text-caption text-ink-3">
            <span>Symbol</span>
            <span>Weight %</span>
          </div>
          {rows.map((r, i) => (
            <div key={r.key} className="grid grid-cols-[1fr_6.5rem_2.75rem] items-center gap-2">
              <input aria-label={`Symbol ${i + 1}`} value={r.symbol} onChange={(e) => set(r.key, { symbol: e.target.value.toUpperCase() })} autoCapitalize="characters" autoComplete="off" spellCheck={false} className={`${field} uppercase`} />
              <input aria-label={`Weight of ${r.symbol || `holding ${i + 1}`}, percent`} value={r.weight} onChange={(e) => set(r.key, { weight: e.target.value })} inputMode="decimal" className={`${field} text-right text-num`} />
              <button type="button" aria-label={`Remove ${r.symbol || `holding ${i + 1}`}`} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} className="press grid h-11 w-11 place-items-center rounded-btn text-ink-3 hover:bg-ledger hover:text-missed">
                <Trash2 size={17} strokeWidth={1.75} aria-hidden="true" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => {
              setRows((rs) => [...rs, { key: nextKey, symbol: "", weight: "" }]);
              setNextKey((k) => k + 1);
            }}
            className="press mt-1 inline-flex h-11 items-center gap-1.5 rounded-btn px-2 font-medium text-royal hover:bg-ledger"
          >
            <Plus size={17} strokeWidth={1.75} aria-hidden="true" />
            Add holding
          </button>
        </div>
      )}
    </Sheet>
  );
}

export function PortfolioPage() {
  const holdings = useQuery(q.holdings());
  const [params, setParams] = useSearchParams();

  if (holdings.isPending) return <Skeleton rows={4} />;
  if (holdings.isError) return <ErrorLine message={holdings.error.message} onRetry={() => holdings.refetch()} />;

  const d = holdings.data.data;
  const filter = (["concern", "watch", "on_track"].includes(params.get("show") ?? "") ? params.get("show") : "all") as Filter;

  const setParam = (k: string, v: string | null) => {
    const next = new URLSearchParams(params);
    v === null ? next.delete(k) : next.set(k, v);
    setParams(next, { replace: k === "show" });
  };

  const filteredItems = filter === "all" ? d.items : d.items.filter((h) => h.state === STATE_OF[filter]);

  const outside = d.mandate.status === "outside";
  return (
    <div className="space-y-4">
      <PageTitle
        action={
          <button
            type="button"
            onClick={() => setParam("sheet", "edit-holdings")}
            className="press mb-0.5 inline-flex h-11 shrink-0 items-center gap-1.5 rounded-btn border border-rule bg-sheet px-3 text-caption font-medium text-ink hover:bg-ledger"
          >
            <Pencil size={14} strokeWidth={1.75} aria-hidden="true" />
            Edit
          </button>
        }
      >
        Holdings
      </PageTitle>

      <PortfolioOverview counts={d.counts} />

      <SegmentedControl
        label="Filter holdings by status"
        value={filter}
        onChange={(v) => setParam("show", v === "all" ? null : v)}
        options={[
          { value: "all", label: "All", count: d.items.length },
          { value: "concern", label: "Off track", count: d.counts.concern },
          { value: "watch", label: "Watch", count: d.counts.watch },
          { value: "on_track", label: "On track", count: d.counts.on_track },
        ]}
      />

      <HoldingsTable holdings={filteredItems} />

      <p className={`flex gap-2 px-1 text-caption ${outside ? "font-medium text-missed" : "text-ink-2"}`}>
        <span aria-hidden="true" className={`font-semibold ${outside ? "text-missed" : "text-met"}`}>
          {outside ? "✕" : "✓"}
        </span>
        {d.mandate.line}
      </p>

      {/* Edit holdings Sheet */}
      {params.get("sheet") === "edit-holdings" && (
        <EditHoldings holdings={d.items} onClose={() => setParam("sheet", null)} />
      )}
    </div>
  );
}
