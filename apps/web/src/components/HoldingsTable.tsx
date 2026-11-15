import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { num, shortName, weight } from "../lib/format";
import { q, type Holding } from "../lib/queries";
import { Pill, STATE_TONE, STATE_WORD } from "../pages/parts";
import { TrendPct } from "./TrendPct";

/**
 * Holdings as a table: one line per cell plus one small line under it, nothing wraps, columns
 * line up at any width. Only figures FINN actually has: last close, the day's move, and weight.
 * (The API also sends cost, quantity and gain, but those are modelled, not the user's book.)
 */
export function HoldingsTable({ holdings }: { holdings: Holding[] }) {
  const qc = useQueryClient();
  const navigate = useNavigate();

  if (holdings.length === 0) {
    return <div className="rounded-card border border-rule bg-sheet px-4 py-6 text-center text-body text-ink-2">No holdings in this view.</div>;
  }

  const th = "py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3";
  return (
    <div className="overflow-hidden rounded-card border border-rule bg-sheet">
      <table className="w-full table-fixed border-collapse text-left">
        <colgroup>
          <col />
          <col className="w-[80px]" />
          <col className="w-[92px]" />
          <col className="w-[60px]" />
        </colgroup>
        <thead>
          <tr className="border-b border-rule">
            <th scope="col" className={`${th} pl-3`}>
              Company
            </th>
            <th scope="col" className={`${th} pl-1`}>
              Status
            </th>
            <th scope="col" className={`${th} pr-3 text-right`}>
              Price
            </th>
            <th scope="col" className={`${th} pr-3 text-right`}>
              Weight
            </th>
          </tr>
        </thead>
        <tbody>
          {holdings.map((h, i) => {
            const prefetch = () => void qc.prefetchQuery(q.company(h.symbol));
            // Real figures only: the last stored close and that session's move.
            // (last_close alone can be the API's 1,500 placeholder when no prices are stored.)
            const close = h.reaction?.close ?? null;
            const move = h.reaction?.change_pct ?? null;
            return (
              <tr
                key={h.symbol}
                onClick={() => navigate(`/c/${h.symbol}`)}
                onPointerEnter={prefetch}
                className={`cursor-pointer border-b border-rule last:border-b-0 hover:bg-ledger ${i % 2 ? "bg-paper/70" : ""}`}
              >
                <td className="py-3 pl-3 pr-2">
                  {/* The name is the real link, for keyboard and screen readers; the row is a bigger target. */}
                  <a
                    href={`/c/${h.symbol}`}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      navigate(`/c/${h.symbol}`);
                    }}
                    onFocus={prefetch}
                    className="block truncate text-[15px] font-semibold leading-5 text-ink"
                  >
                    {shortName(h.name)}
                  </a>
                  <span className="block truncate text-[12px] leading-4 text-ink-3">{h.symbol}</span>
                </td>
                <td className="py-3 pl-1" title={h.state_reasons[0]}>
                  <Pill tone={STATE_TONE[h.state]}>{STATE_WORD[h.state]}</Pill>
                </td>
                <td className="py-3 pr-3 text-right">
                  <span className="block whitespace-nowrap text-num font-medium text-ink">{close !== null ? `₹${num(close, close < 100 ? 2 : 0)}` : "–"}</span>
                  <span className="block whitespace-nowrap text-[12px] leading-4">
                    <TrendPct value={move} digits={1} />
                  </span>
                </td>
                <td className="py-3 pr-3 text-right text-num font-medium text-ink">{weight(h.weight_pct)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
