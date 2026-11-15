import { BROWSER_HEADERS, HttpError, PoliteHttp } from "../http/polite";
import { runIngest, type RunOutcome } from "../ingest/run";
import type { CoreDeps } from "../ports";

/** NSE's list of every listed equity: a static CSV on the archives host. */
export const NSE_EQUITY_LIST_URL = "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv";

export interface ListedCompany {
  symbol: string;
  name: string;
  isin: string;
  /** Banks get the bank results card (no EBITDA). A name rule; NBFCs are set by hand. */
  is_bank: boolean;
}

/** One CSV line, honouring quoted fields ("Name, Limited"). */
function csvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else q = !q;
    } else if (ch === "," && !q) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/**
 * EQUITY_L.csv → companies. Rows with a symbol or ISIN the schema would refuse are skipped,
 * not guessed at.
 */
export function parseNseEquityList(csv: string): ListedCompany[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  const head = csvLine(lines[0] ?? "").map((h) => h.toUpperCase());
  const col = (name: string) => head.findIndex((h) => h === name);
  const iSym = col("SYMBOL");
  const iName = col("NAME OF COMPANY");
  const iIsin = col("ISIN NUMBER");
  if (iSym < 0 || iName < 0 || iIsin < 0) throw new Error("EQUITY_L.csv: expected SYMBOL, NAME OF COMPANY and ISIN NUMBER columns");
  const seen = new Set<string>();
  const out: ListedCompany[] = [];
  for (const l of lines.slice(1)) {
    const f = csvLine(l);
    const symbol = (f[iSym] ?? "").toUpperCase();
    const name = (f[iName] ?? "").replace(/\s+/g, " ");
    const isin = (f[iIsin] ?? "").toUpperCase();
    if (!/^[A-Z0-9&-]{1,20}$/.test(symbol) || !/^IN[A-Z0-9]{9}[0-9]$/.test(isin) || !name || name.length > 200 || seen.has(symbol)) continue;
    seen.add(symbol);
    out.push({ symbol, name, isin, is_bank: /\bbank\b/i.test(name) });
  }
  return out;
}

/** Load the NSE list into companies. Existing rows are left alone (their BSE codes and flags were set with care). */
export async function loadCompanyList(deps: CoreDeps, url = NSE_EQUITY_LIST_URL): Promise<RunOutcome<{ listed: number; added: number }>> {
  return runIngest(deps, "nse_equity_list", async () => {
    if (!deps.store.upsertCompanies) throw new Error("this store cannot write companies");
    const http = new PoliteHttp(deps.http, deps.clock, deps.log, { timeoutMs: 60_000 }, deps.random);
    const res = await http.request({ url, headers: { ...BROWSER_HEADERS, accept: "text/csv,*/*" } });
    if (res.status !== 200) throw new HttpError(res.status, url);
    const rows = parseNseEquityList(await res.text());
    if (rows.length < 1000) throw new Error(`EQUITY_L.csv has only ${rows.length} usable rows; refusing to load a partial list`);
    const added = await deps.store.upsertCompanies(rows);
    return { rows: added, partial: null, result: { listed: rows.length, added } };
  });
}
