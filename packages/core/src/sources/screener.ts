import { load } from "cheerio/slim"; // parser only; the full "cheerio" entry pulls in an HTTP client
import type { Basis } from "@finn/shared";
import { BROWSER_HEADERS, HttpError, PoliteHttp } from "../http/polite";
import { runIngest, type RunOutcome } from "../ingest/run";
import type { ActualRow, CoreDeps } from "../ports";
import { fiscalQuarter, fiscalYear } from "../time";

const BASE = "https://www.screener.in/company/";

export interface ScreenerTable {
  /** Column headers as shown: "Sep 2025", "Mar 2025", "TTM". */
  periods: string[];
  rows: { label: string; values: (number | null)[] }[];
}

export interface ScreenerFinancials {
  symbol: string;
  basis: Basis;
  url: string;
  quarters: ScreenerTable;
  profit_loss: ScreenerTable;
  balance_sheet: ScreenerTable;
  cash_flow: ScreenerTable;
}

type Sections = Omit<ScreenerFinancials, "symbol" | "basis" | "url">;

const SECTION_IDS = {
  quarters: "quarters",
  profit_loss: "profit-loss",
  balance_sheet: "balance-sheet",
  cash_flow: "cash-flow",
} as const;

/** Parse the four financial tables from a Screener company page. Pure; exported for tests. */
export function parseScreenerPage(html: string): Sections {
  const $ = load(html);
  const table = (id: string): ScreenerTable => {
    const t = $(`section#${id} table.data-table`).first();
    const periods = t
      .find("thead th")
      .toArray()
      .slice(1)
      .map((th) => clean($(th).text()));
    const rows = t
      .find("tbody tr")
      .toArray()
      .map((tr) => {
        const cells = $(tr).find("td").toArray();
        const label = clean($(cells[0]).text()).replace(/\s*\+$/, "");
        const values = cells.slice(1).map((td) => parseNumber($(td).text()));
        return { label, values };
      })
      .filter((r) => r.label && r.values.some((v) => v !== null));
    return { periods, rows };
  };
  return {
    quarters: table(SECTION_IDS.quarters),
    profit_loss: table(SECTION_IDS.profit_loss),
    balance_sheet: table(SECTION_IDS.balance_sheet),
    cash_flow: table(SECTION_IDS.cash_flow),
  };
}

function clean(s: string): string {
  return s.replace(/[\s ]+/g, " ").trim();
}

/** "1,234.5" → 1234.5, "12%" → 12, "" → null. */
export function parseNumber(s: string): number | null {
  const t = clean(s).replace(/,/g, "").replace(/%$/, "");
  if (t === "" || t === "-") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * Consolidated first. Falls back to standalone when the consolidated page is missing (404),
 * redirects to the standalone page, or has no quarterly figures.
 */
export async function fetchScreener(deps: CoreDeps, symbol: string): Promise<RunOutcome<ScreenerFinancials>> {
  return runIngest(deps, "screener", async () => {
    const http = new PoliteHttp(deps.http, deps.clock, deps.log, {}, deps.random);
    const get = async (url: string) => {
      const res = await http.request({ url, headers: { ...BROWSER_HEADERS, accept: "text/html" } });
      if (res.status === 404) return null;
      if (res.status !== 200) throw new HttpError(res.status, url);
      return { finalUrl: res.url, html: await res.text() };
    };

    const enc = encodeURIComponent(symbol);
    const consolidatedUrl = `${BASE}${enc}/consolidated/`;
    let basis: Basis = "consolidated";
    let url = consolidatedUrl;
    let page = await get(consolidatedUrl);
    let sections = page && page.finalUrl.includes("/consolidated") ? parseScreenerPage(page.html) : null;

    if (!sections || sections.quarters.rows.length === 0) {
      deps.log.info(`screener: no consolidated figures for ${symbol}, using standalone`);
      basis = "standalone";
      url = `${BASE}${enc}/`;
      page = await get(url);
      if (!page) throw new Error(`Screener has no page for ${symbol}`);
      sections = parseScreenerPage(page.html);
    }

    const f: ScreenerFinancials = { symbol, basis, url, ...sections };
    const missing = (Object.keys(SECTION_IDS) as (keyof Sections)[]).filter((k) => f[k].rows.length === 0);
    if (missing.length === 4) throw new Error(`Screener page for ${symbol} had no financial tables (layout change?)`);

    const actuals = toActuals(f);
    const written = await deps.store.upsertActuals(actuals);
    return {
      rows: written,
      partial: missing.length ? `${symbol}: missing ${missing.join(", ")}` : null,
      result: f,
    };
  });
}

/**
 * Map tables to `actuals` rows. Quarterly → Q2FY26 etc.; annual → FY25. TTM and non-March
 * year-end columns are skipped. Balance sheet and cash flow metrics are prefixed (bs_, cf_)
 * so they can't collide with P&L lines of the same name.
 */
export function toActuals(f: ScreenerFinancials): ActualRow[] {
  const out = new Map<string, ActualRow>();
  const add = (t: ScreenerTable, periodOf: (p: string) => string | null, prefix: string) => {
    t.periods.forEach((p, i) => {
      const period = periodOf(p);
      if (!period) return;
      for (const r of t.rows) {
        const value = r.values[i];
        if (value === null || value === undefined) continue;
        const metric = prefix + slug(r.label);
        out.set(`${period}|${metric}`, {
          symbol: f.symbol,
          period,
          metric,
          basis: f.basis,
          value,
          unit: r.label.includes("%") ? "pct" : /^EPS\b/i.test(r.label) ? "other" : "inr_cr",
          source: "screener",
        });
      }
    });
  };
  add(f.quarters, fiscalQuarter, "");
  add(f.profit_loss, fiscalYear, "");
  add(f.balance_sheet, fiscalYear, "bs_");
  add(f.cash_flow, fiscalYear, "cf_");
  return [...out.values()];
}

function slug(label: string): string {
  return label
    .toLowerCase()
    .replace(/%/g, " pct ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
