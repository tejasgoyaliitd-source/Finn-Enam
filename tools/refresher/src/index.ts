// Run FINN ingestion from this machine. Same packages/core code as the API cron, but from a
// residential connection that NSE doesn't block.
//
//   pnpm refresh --portfolio                     prices + filings for the demo portfolio
//   pnpm refresh --symbol DIXON                  prices + filings + Screener tables for DIXON
//   pnpm refresh --symbol DIXON,KAYNES --only filings --since 30d
//   pnpm refresh --doc <pdf-url> --symbol DIXON --type transcript --period Q2FY27
//   pnpm refresh --transcript <pdf-url> --symbol KPITTECH --period Q2FY27   guidance → verdicts → concall card
//   pnpm refresh --results-pdf <pdf-url> --symbol DIXON                   results card
//   pnpm refresh --annual-report <pdf-url> --symbol DIXON --period FY26  ethical mandate check
//   pnpm refresh --people-pdf <pdf-url> --symbol POLYCAB [--filing-id N]  management change
//   pnpm refresh --governance --symbol DIXON                              12-month governance strip
//   pnpm refresh --companies                                              load the NSE equity list (search any company)
//   add --dry-run to fetch and parse without touching Supabase
import { parseArgs } from "node:util";
import { loadCompanyList, checkAnnualReportMandate, describeItem, extractDocument, extractPeopleChange, extractResults, governanceStrip, processTranscript, refresh, toIst, type DocumentInput, type RefreshPart } from "@finn/core";
import { buildDeps, loadEnv } from "./deps";
import { printDocument, printReport } from "./report";

const HELP = `FINN refresher

Targets (pick one):
  --portfolio [--portfolio-id <uuid>]   all holdings (default: demo portfolio)
  --symbol <SYM[,SYM...]>               specific companies (repeatable)
  --doc <url> --symbol <SYM> --type <annual_report|transcript|results|filing|presentation> [--period <FY27|Q2FY27>]

Model-backed checks (need GEMINI_API_KEY / GROQ_API_KEY / ANTHROPIC_API_KEY in .env), one --symbol each:
  --transcript <url> --period <Q2FY27>  guidance, verdicts and concall card
  --results-pdf <url>                   results card from the results PDF
  --annual-report <url> --period <FY26> ethical mandate (segment note)
  --people-pdf <url> [--filing-id <n>]  management change details and senior-exit count
  --governance                          12-month governance strip from stored filings
  --companies                           load NSE's list of listed equities, so any company can be searched

Options:
  --only <prices,filings,screener>      default: prices,filings for --portfolio; all three for --symbol
  --since <7d|YYYY-MM-DD>               filings window start (default 7d)
  --dry-run                             fetch and parse, write nothing (no Supabase needed)
  --quiet                               warnings and the summary only
`;

const PARTS: RefreshPart[] = ["prices", "filings", "screener"];
const DOC_TYPES = ["annual_report", "transcript", "results", "filing", "presentation"] as const;

async function main(): Promise<number> {
  // `pnpm refresh -- --x` forwards the literal "--"; drop it so flags still parse.
  const argv = process.argv.slice(2).filter((a, i) => !(i === 0 && a === "--"));
  const { values: v } = parseArgs({
    args: argv,
    options: {
      portfolio: { type: "boolean", default: false },
      "portfolio-id": { type: "string" },
      symbol: { type: "string", multiple: true },
      doc: { type: "string" },
      transcript: { type: "string" },
      "results-pdf": { type: "string" },
      "annual-report": { type: "string" },
      "people-pdf": { type: "string" },
      "filing-id": { type: "string" },
      governance: { type: "boolean", default: false },
      type: { type: "string" },
      period: { type: "string" },
      only: { type: "string" },
      since: { type: "string", default: "7d" },
      "dry-run": { type: "boolean", default: false },
      quiet: { type: "boolean", default: false },
      companies: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  const symbols = (v.symbol ?? []).flatMap((s) => s.split(",")).map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (v.companies) {
    loadEnv();
    const deps = buildDeps({ dryRun: v["dry-run"], quiet: v.quiet });
    const o = await loadCompanyList(deps);
    console.log(o.ok ? `NSE list: ${o.result.listed} companies, ${o.result.added} new` : `FAILED — ${o.error}`);
    return o.ok ? 0 : 1;
  }
  if (v.help || (!v.portfolio && symbols.length === 0)) {
    console.log(HELP);
    return v.help ? 0 : 2;
  }

  loadEnv();
  const deps = buildDeps({ dryRun: v["dry-run"], quiet: v.quiet });
  if (v["dry-run"]) deps.log.warn("dry run: nothing will be written to Supabase");

  const one = v.transcript || v["results-pdf"] || v["annual-report"] || v["people-pdf"] || v.governance;
  if (one) {
    if (symbols.length !== 1) {
      console.error("this command needs exactly one --symbol");
      return 2;
    }
    const symbol = symbols[0]!;
    const company = (await deps.store.getCompany(symbol)) ?? { symbol, bse_code: null, is_bank: false };
    if (!deps.llm && !v.governance) deps.log.warn("no model key set: model-backed steps will fail closed or use rules only");
    const show = (o: { ok: boolean; error?: string; result?: unknown; note?: string | null }) => {
      console.log(o.ok ? JSON.stringify(o.result, null, 2) : `FAILED — ${o.error}`);
      if (o.ok && o.note) console.log(`note: ${o.note}`);
      return o.ok ? 0 : 1;
    };
    if (v.governance) {
      const strip = await governanceStrip(deps, symbol);
      console.log(strip.line);
      return 0;
    }
    if (v.transcript) {
      if (!v.period) return console.error("--transcript needs --period like Q2FY27"), 2;
      const o = await processTranscript(deps, { company, url: v.transcript, call_period: v.period });
      if (o.ok) {
        console.log(`kept ${o.result.kept}, dropped ${o.result.dropped.length}, reported figures ${o.result.reported}`);
        for (const d of o.result.dropped) console.log(`  dropped p.${d.page}: ${d.reason}`);
        for (const i of o.result.card.items) console.log(`  ${describeItem(i)}`);
        console.log(o.result.card.credibility);
        return 0;
      }
      return show(o);
    }
    if (v["results-pdf"]) return show(await extractResults(deps, { company, filing_id: null, filed_at: toIst(deps.clock.now()), pdf_url: v["results-pdf"] }));
    if (v["annual-report"]) {
      if (!v.period) return console.error("--annual-report needs --period like FY26"), 2;
      const o = await checkAnnualReportMandate(deps, { symbol, url: v["annual-report"], period: v.period });
      if (o.ok) console.log(o.result.line);
      return show(o);
    }
    if (v["people-pdf"]) return show(await extractPeopleChange(deps, { symbol, filing_id: Number(v["filing-id"] ?? 0), pdf_url: v["people-pdf"] }));
  }

  if (v.doc) {
    const type = v.type as DocumentInput["type"] | undefined;
    if (symbols.length !== 1 || !type || !DOC_TYPES.includes(type)) {
      console.error("--doc needs exactly one --symbol and a --type of: " + DOC_TYPES.join(", "));
      return 2;
    }
    const out = await extractDocument(deps, { symbol: symbols[0]!, type, period: v.period ?? null, url: v.doc });
    printDocument(out);
    return out.ok ? 0 : 1;
  }

  const parts = v.only
    ? v.only.split(",").map((s) => s.trim() as RefreshPart)
    : v.portfolio
      ? (["prices", "filings"] as RefreshPart[])
      : PARTS;
  const bad = parts.filter((p) => !PARTS.includes(p));
  if (bad.length) {
    console.error(`Unknown --only part(s): ${bad.join(", ")}. Use: ${PARTS.join(", ")}`);
    return 2;
  }

  const since = parseSince(v.since, deps.clock.now());
  if (!since) {
    console.error(`--since must look like 7d or 2026-11-01, got "${v.since}"`);
    return 2;
  }

  const report = await refresh(deps, {
    target: v.portfolio ? { portfolio: v["portfolio-id"] } : { symbols },
    parts,
    since,
  });
  return printReport(report, deps.memory);
}

function parseSince(s: string, now: Date): Date | null {
  const rel = /^(\d{1,3})d$/.exec(s);
  if (rel) return new Date(now.getTime() - Number(rel[1]) * 86_400_000);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T00:00:00+05:30`);
  return null;
}

main().then(
  // exitCode, not process.exit(): exiting while fetch sockets close trips a libuv assertion on Windows.
  (code) => (process.exitCode = code),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  },
);
