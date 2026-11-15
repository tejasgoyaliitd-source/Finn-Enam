import type { ActualRow } from "../ports";
import { periodQuarters, priorYear, quarterOrdinal, quarterFromOrdinal } from "./periods";

/**
 * Actual figures for one company, from two kinds of source:
 *   standard — FINN's own consistent figures (Screener statement lines: sales, operating
 *              profit, net profit), so every company is measured the same way.
 *   reported — what management stated on a call for a finished period, in the company's own
 *              definition (source "transcript", canonical metric key).
 * Verdicts use the reported figure when there is one (guidance was given in the company's
 * definition) and show the standard one next to it when they differ.
 */
export class ActualsBook {
  private readonly std = new Map<string, number>(); // "sales|Q2FY27"
  private readonly rep = new Map<string, number>(); // "ebitda_margin|FY26"

  constructor(rows: ActualRow[], basis: "consolidated" | "standalone" = "consolidated") {
    const useBasis = rows.some((r) => r.basis === basis) ? basis : (rows[0]?.basis ?? basis);
    for (const r of rows) {
      if (r.basis !== useBasis) continue;
      if (r.source === "transcript") this.rep.set(`${r.metric}|${r.period}`, r.value);
      else {
        const line = r.metric === "revenue" ? "sales" : r.metric; // banks: Screener "Revenue"
        this.std.set(`${line}|${r.period}`, r.value);
      }
    }
  }

  /** Latest quarter with reported sales. */
  latestQuarter(): string | null {
    let best = 0;
    for (const k of this.std.keys()) {
      const [line, p] = k.split("|");
      if (line === "sales" && /^Q[1-4]FY\d{2}$/.test(p!)) best = Math.max(best, quarterOrdinal(p!));
    }
    return best ? quarterFromOrdinal(best) : null;
  }

  reported(metric: string, period: string): number | null {
    return this.rep.get(`${metric}|${period}`) ?? null;
  }

  /** A statement line summed over quarters; for a full year the annual line is preferred. */
  private line(name: string, quarters: string[]): number | null {
    const fy = quarters.length === 4 && quarters[0]!.startsWith("Q1") ? quarters[0]!.slice(2) : null;
    if (fy && this.std.has(`${name}|${fy}`)) return this.std.get(`${name}|${fy}`)!;
    let sum = 0;
    for (const q of quarters) {
      const v = this.std.get(`${name}|${q}`);
      if (v === undefined) return null;
      sum += v;
    }
    return sum;
  }

  /** FINN's standard figure for `metric` over the given quarters (default: the whole period). */
  standard(metric: string, period: string, quarters = periodQuarters(period)): number | null {
    const priorQ = quarters.map((q) => periodQuarters(priorYear(q))[0]!);
    const ratio = (a: number | null, b: number | null) => (a !== null && b !== null && b !== 0 ? (a / b) * 100 : null);
    const growth = (a: number | null, b: number | null) => (a !== null && b !== null && b > 0 ? (a / b - 1) * 100 : null);
    const r2 = (x: number | null) => (x === null ? null : Math.round(x * 100) / 100);
    switch (metric) {
      case "revenue": return r2(this.line("sales", quarters));
      case "ebitda": return r2(this.line("operating_profit", quarters));
      case "pat": return r2(this.line("net_profit", quarters));
      case "ebitda_margin": return r2(ratio(this.line("operating_profit", quarters), this.line("sales", quarters)));
      case "pat_margin": return r2(ratio(this.line("net_profit", quarters), this.line("sales", quarters)));
      case "revenue_growth": return r2(growth(this.line("sales", quarters), this.line("sales", priorQ)));
      case "ebitda_growth": return r2(growth(this.line("operating_profit", quarters), this.line("operating_profit", priorQ)));
      case "pat_growth": return r2(growth(this.line("net_profit", quarters), this.line("net_profit", priorQ)));
      default: return null;
    }
  }
}
