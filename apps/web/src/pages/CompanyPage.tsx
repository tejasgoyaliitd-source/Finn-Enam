import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, NavLink, useParams, useSearchParams } from "react-router";
import { ChevronRight, MessageCircleQuestion } from "lucide-react";
import { Sparkline, CashBars, MiniLine } from "../components/Charts";
import {
  ChipRow,
  CheckList,
  ResultsTable,
  SourceChip,
} from "../components/Evidence";
import { useSheetHref } from "../components/ItemRow";
import { JobSteps } from "../components/JobSteps";
import { SegmentedControl } from "../components/SegmentedControl";
import { Sheet } from "../components/Sheet";
import { TrendPct } from "../components/TrendPct";
import { api } from "../lib/api";
import { istDate, num, shortName, trueMinus, weight } from "../lib/format";
import {
  bustCache,
  q,
  type Cite,
  type CompanyData,
  type JobData,
  type RecordItem,
  type VerdictCode,
} from "../lib/queries";
import {
  cardClass,
  ErrorLine,
  PageTitle,
  Pill,
  Skeleton,
  STATE_TONE,
  STATE_WORD,
} from "./parts";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "guidance", label: "Guidance" },
  { id: "results", label: "Results" },
  { id: "filings", label: "Filings" },
  { id: "research", label: "Research" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const cite = (c: Cite) =>
  c.url ? (
    <SourceChip source={{ label: c.label, url: c.url, page: c.page }} />
  ) : (
    <span className="text-caption text-ink-3">{c.label}</span>
  );

/** A titled card: the label sits above it, the content inside the app's one card style. */
function Block({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h3 className="text-caption font-semibold text-ink-2">{title}</h3>
        {action}
      </div>
      <div className={`${cardClass} px-4 py-3`}>{children}</div>
    </section>
  );
}

const Pending = ({ children }: { children: React.ReactNode }) => (
  <p className="rounded-btn bg-ledger px-3 py-2 text-caption text-ink-2">
    {children}
  </p>
);

// ─── Research job: start, poll every 2 s, refresh the page when it lands ───────

/**
 * `fresh` is true only once the company was fetched after this page mounted: a cached copy from
 * before a finished job still says "none", and must not start a second job.
 */
function useResearch(
  symbol: string,
  d: CompanyData | undefined,
  fresh: boolean,
) {
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const [jobId, setJobId] = useState<string | null>(null);
  const start = useMutation({
    mutationFn: () =>
      api<{ job_id: string }>(`/v1/research/${encodeURIComponent(symbol)}`, {
        method: "POST",
      }),
    onSuccess: (r) => setJobId(r.data.job_id),
  });
  const status = d?.research;
  const id = jobId ?? (status?.status === "running" ? status.job_id : null);

  // A company opened from Research, or one you don't hold, starts reading on arrival.
  const started = useRef(false);
  useEffect(() => {
    if (!d || !fresh || started.current || status?.status !== "none") return;
    if (params.get("read") === "1" || !d.header.held) {
      started.current = true;
      start.mutate();
    }
  }, [d, fresh, status?.status, params, start]);

  const job = useQuery({
    ...q.job(id ?? "none"),
    enabled: !!id,
    refetchInterval: (query) => {
      const s = (query.state.data as { data?: JobData } | undefined)?.data
        ?.status;
      return s === "done" || s === "failed" ? false : 2000;
    },
  });
  const jd = job.data?.data;
  const finished = jd?.status === "done";
  useEffect(() => {
    if (finished) {
      bustCache();
      void qc.invalidateQueries({ queryKey: ["company", symbol] });
      void qc.invalidateQueries({ queryKey: ["research-list"] });
    }
  }, [finished, qc, symbol]);
  return {
    job: jd,
    starting: start.isPending,
    startError: start.error,
    start: () => start.mutate(),
    running: !!id && !finished && jd?.status !== "failed",
  };
}

function Reading({
  name,
  job,
  starting,
}: {
  name: string;
  job: JobData | undefined;
  starting: boolean;
}) {
  return (
    <section
      aria-labelledby="reading"
      className="space-y-3 rounded-card border border-rule bg-sheet px-4 py-4"
    >
      <h2 id="reading" className="text-section font-semibold text-ink">
        Reading primary sources…
      </h2>
      {job ? (
        <JobSteps job={job} />
      ) : (
        <p className="text-body text-ink-2">
          {starting
            ? `Starting research on ${name}.`
            : "Waiting for the first step."}
        </p>
      )}
      <p className="text-caption text-ink-3">
        Usually takes 1 to 3 minutes. You can switch tabs; the result will be on
        this company's page.
      </p>
    </section>
  );
}

// ─── Header ─────────────────────────────────────────────────────────────────

function Header({ d }: { d: CompanyData }) {
  const h = d.header;
  return (
    <section className="space-y-3">
      <div>
        <PageTitle>{shortName(h.name)}</PageTitle>
        <p className="text-caption text-ink-3">
          {h.symbol} ·{" "}
          {h.weight_pct !== null
            ? `${weight(h.weight_pct)} of book`
            : "Not in your portfolio"}
        </p>
      </div>
      {h.last_close !== null ? (
        <div
          className={`${cardClass} flex items-center justify-between gap-4 px-4 py-3`}
        >
          <div className="min-w-0">
            <p className="flex items-baseline gap-2">
              <span className="text-title font-semibold text-ink">
                ₹{num(h.last_close, h.last_close < 100 ? 2 : 0)}
              </span>
              {h.change_pct !== null && (
                <TrendPct
                  value={h.change_pct}
                  digits={1}
                  className="text-caption"
                />
              )}
            </p>
            {h.price_date && (
              <p className="text-caption text-ink-3">
                Close, {istDate(`${h.price_date}T12:00:00+05:30`)}
              </p>
            )}
          </div>
          <Sparkline
            values={h.sparkline}
            label={`Price over the last ${h.sparkline.length} sessions, from ₹${num(h.sparkline[0] ?? 0)} to ₹${num(h.sparkline.at(-1) ?? 0)}`}
          />
        </div>
      ) : (
        <p className="text-caption text-ink-3">
          No prices on file yet. Research loads them.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {h.state ? (
          <Pill tone={STATE_TONE[h.state]}>{STATE_WORD[h.state]}</Pill>
        ) : (
          <Pill tone="quiet">Not tracked</Pill>
        )}
        <span className="min-w-0 text-caption text-ink-2">
          {trueMinus(
            h.state
              ? (h.state_reason ?? "")
              : "FINN follows filings for your holdings only",
          )}
        </span>
      </div>
    </section>
  );
}

// ─── Overview ───────────────────────────────────────────────────────────────

function Overview({ d }: { d: CompanyData }) {
  const href = useSheetHref();
  const [params, setParams] = useSearchParams();
  const showQ = params.get("sheet") === "questions";
  const setSheet = (v: string | null) => {
    const n = new URLSearchParams(params);
    v ? n.set("sheet", v) : n.delete("sheet");
    setParams(n, { replace: !v });
  };
  const m = d.mandate;
  const outside = m.status === "excluded" || m.status === "breach";
  return (
    <div className="space-y-6">
      <Block title="Latest">
        {d.latest_event ? (
          <Link
            to={href(d.latest_event.filing_id)}
            className="press -mx-2 flex min-h-14 items-center justify-between gap-3 rounded-btn px-2 py-2 hover:bg-sheet"
          >
            <span>
              <span className="block font-medium text-ink">
                {trueMinus(d.latest_event.headline)}
              </span>
              <span className="block text-caption text-ink-2">
                {istDate(d.latest_event.filed_at)}. {d.latest_event.reasons[0]}
              </span>
            </span>
            <ChevronRight
              size={16}
              strokeWidth={1.75}
              aria-hidden="true"
              className="shrink-0 text-ink-3"
            />
          </Link>
        ) : (
          <p className="text-body text-ink-2">
            {d.header.held
              ? "Nothing material in the last 90 days."
              : "FINN doesn't track filings for companies you don't hold."}
          </p>
        )}
      </Block>

      <Block title="Governance">
        {d.governance.count === 0 ? (
          <p className="text-body text-ink">
            {d.governance.checked !== false && (
              <span aria-hidden="true" className="font-semibold text-met">
                ✓{" "}
              </span>
            )}
            {d.governance.line}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {d.governance.flags.map((f, i) => (
              <li key={i} className="flex gap-2 text-body">
                <span
                  aria-hidden="true"
                  className="w-4 shrink-0 text-center font-semibold text-missed"
                >
                  ✕
                </span>
                <span className="text-ink">
                  <span className="sr-only">Flag: </span>
                  {f.detail}{" "}
                  <span className="text-caption text-ink-3">{f.date}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Block>

      <Block title="Mandate">
        <p
          className={`text-body ${outside ? "font-medium text-missed" : "text-ink"}`}
        >
          <span
            aria-hidden="true"
            className={`font-semibold ${outside ? "text-missed" : m.status === "clean" ? "text-met" : "text-ink-3"}`}
          >
            {outside ? "✕ " : m.status === "clean" ? "✓ " : "○ "}
          </span>
          {m.status === "clean" ? m.line || "Within your exclusions" : m.line}
        </p>
      </Block>

      <button
        type="button"
        onClick={() => setSheet("questions")}
        disabled={d.questions.length === 0}
        className="press flex min-h-14 w-full items-center justify-between gap-3 rounded-card border border-rule bg-sheet px-4 py-3 text-left hover:bg-ledger disabled:hover:bg-sheet"
      >
        <span className="flex items-center gap-2.5">
          <MessageCircleQuestion
            size={18}
            strokeWidth={1.75}
            aria-hidden="true"
            className="text-royal"
          />
          <span>
            <span className="block font-medium text-ink">
              Gaps Identified ({d.questions.length})
            </span>
            <span className="block text-caption text-ink-2">
              {d.questions.length
                ? "From gaps in the record and the numbers, each with its source"
                : "No gaps to ask about yet"}
            </span>
          </span>
        </span>
        {d.questions.length > 0 && (
          <ChevronRight
            size={16}
            strokeWidth={1.75}
            aria-hidden="true"
            className="shrink-0 text-ink-3"
          />
        )}
      </button>
      {showQ && (
        <Sheet
          title="Questions for management"
          subtitle={`${d.questions.length} from the record and the numbers`}
          onClose={() => setSheet(null)}
        >
          <ol className="space-y-5">
            {d.questions.map((x, i) => (
              <li key={i} className="space-y-1.5">
                <p className="text-body font-medium text-ink">
                  {i + 1}. {trueMinus(x.text)}
                </p>
                <p className="text-caption text-ink-2">
                  Why: {trueMinus(x.why)}
                </p>
                <ChipRow>{cite(x.source)}</ChipRow>
              </li>
            ))}
          </ol>
        </Sheet>
      )}
    </div>
  );
}

// ─── Guidance: what management promised, and what happened ────────────────────

type Bucket = "met" | "missed" | "pending" | "unchecked";
const bucketOf = (v: VerdictCode | null): Bucket =>
  v === "met"
    ? "met"
    : v === "missed"
      ? "missed"
      : v === "not_measurable"
        ? "unchecked"
        : "pending";
const SQUARE: Record<Bucket, string> = {
  met: "bg-met",
  missed: "bg-missed",
  pending: "bg-ink-3/40",
  unchecked: "border border-ink-3 bg-transparent",
};
const BUCKET_WORD: Record<Bucket, string> = {
  met: "Met",
  missed: "Missed",
  pending: "Pending",
  unchecked: "Can't check",
};
const WORD: Partial<Record<VerdictCode, { text: string; tone: string }>> = {
  met: { text: "Met", tone: "text-met" },
  missed: { text: "Missed", tone: "text-missed" },
  behind: { text: "Behind", tone: "text-behind-text" },
  revised: { text: "Revised", tone: "text-ink-2" },
  too_early: { text: "Too early", tone: "text-ink-3" },
  not_mentioned_since: { text: "Not mentioned since", tone: "text-ink-3" },
  not_measurable: { text: "Can't check yet", tone: "text-ink-3" },
};

/** "p. 6": opens the call transcript at that page. Plain text when FINN has no link to the file. */
function PageLink({ url, page }: { url: string | null; page: number }) {
  if (!url)
    return <span className="shrink-0 text-caption text-ink-3">p. {page}</span>;
  return (
    <a
      href={`${url}#page=${page}`}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="press -my-2 -mr-2 inline-flex min-h-11 shrink-0 items-center rounded-btn px-2 text-caption font-medium text-royal underline underline-offset-2 hover:bg-ledger"
    >
      p. {page}
      <span className="sr-only">
        {" "}
        of the source document (opens in a new tab)
      </span>
    </a>
  );
}

function PromiseRow({ s }: { s: RecordItem }) {
  const b = bucketOf(s.verdict);
  const word = s.verdict ? WORD[s.verdict] : undefined;
  const raw = `${s.metric}${s.scope ? ` (${s.scope})` : ""} ${s.target}${s.period_target ? ` in ${s.period_target}` : ""}`;
  const promise = raw.charAt(0).toUpperCase() + raw.slice(1);
  const actual = s.delivered ?? s.pace_note ?? s.reason;
  return (
    <li className="px-4 py-3">
      <details>
        <summary className="flex cursor-pointer list-none gap-3 [&::-webkit-details-marker]:hidden">
          <span
            aria-hidden="true"
            className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-[2px] ${SQUARE[b]}`}
          />
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] leading-5 text-ink">
              {trueMinus(promise)}
            </span>
            <span className="mt-0.5 block text-caption text-ink-2">
              {actual ? `${trueMinus(actual)} ` : ""}
              {/* An unchecked promise already says why; its word is for screen readers only. */}
              {word && (
                <span
                  className={`font-medium ${word.tone} ${b === "unchecked" ? "sr-only" : ""}`}
                >
                  {word.text}
                </span>
              )}
            </span>
          </span>
          <PageLink url={s.source_url} page={s.page} />
        </summary>
        {/* Tap a promise for management's exact words. */}
        <blockquote className="quote ml-5 mt-2 border-l-2 border-rule pl-3 text-[15px] leading-6 text-ink">
          “{s.quote}”
        </blockquote>
      </details>
    </li>
  );
}

function GuidanceTab({
  symbol,
  name,
  research,
}: {
  symbol: string;
  name: string;
  research: CompanyData["research"];
}) {
  const rec = useQuery(q.record(symbol));
  if (rec.isPending) return <Skeleton rows={3} />;
  if (rec.isError)
    return (
      <ErrorLine message={rec.error.message} onRetry={() => rec.refetch()} />
    );
  const items = rec.data.data.items;
  if (items.length === 0) {
    return (
      <div className={`${cardClass} space-y-1 px-4 py-4`}>
        <p className="font-medium text-ink">No promises on record yet</p>
        <p className="text-caption text-ink-2">
          {research.status === "ready"
            ? `FINN has ${name}'s documents but hasn't pulled the guidance out of the calls yet.`
            : `Guidance comes from ${name}'s earnings calls, which FINN hasn't read yet.`}
        </p>
      </div>
    );
  }
  const count = (b: Bucket) =>
    items.filter((s) => bucketOf(s.verdict) === b).length;
  const shown = (["met", "missed", "pending", "unchecked"] as Bucket[]).filter(
    (b) => b !== "unchecked" || count(b) > 0,
  );
  // Grouped by where it was said, newest call first (the API sorts them that way).
  const groups = new Map<string, RecordItem[]>();
  for (const s of items) groups.set(s.call, [...(groups.get(s.call) ?? []), s]);
  return (
    <div className="space-y-4">
      <p
        className="flex flex-wrap gap-x-4 gap-y-1 px-1 text-caption text-ink-2"
        aria-label={shown
          .map((b) => `${BUCKET_WORD[b]} ${count(b)}`)
          .join(", ")}
      >
        {shown.map((b) => (
          <span
            key={b}
            aria-hidden="true"
            className="inline-flex items-center gap-1.5"
          >
            <span className={`h-2.5 w-2.5 rounded-[2px] ${SQUARE[b]}`} />
            {BUCKET_WORD[b]}{" "}
            <span className="font-semibold text-ink">{count(b)}</span>
          </span>
        ))}
      </p>
      {[...groups].map(([call, list]) => (
        <section key={call} aria-label={`${call} call`} className="space-y-2">
          <h3 className="px-1 text-caption font-semibold text-ink-2">
            {call} earnings call
          </h3>
          <ul className={`${cardClass} divide-y divide-rule`}>
            {list.map((s) => (
              <PromiseRow key={s.id} s={s} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

// ─── Results ────────────────────────────────────────────────────────────────

function ResultsTab({ symbol }: { symbol: string }) {
  const [period, setPeriod] = useState<string | null>(null);
  const res = useQuery(q.results(symbol, period));
  const href = useSheetHref();
  if (res.isPending) return <Skeleton rows={4} />;
  if (res.isError)
    return (
      <ErrorLine message={res.error.message} onRetry={() => res.refetch()} />
    );
  const d = res.data.data;
  if (!d.card) return <Pending>{d.note ?? "No results on file yet."}</Pending>;
  const r = d.card;
  return (
    <div className="space-y-5" aria-busy={res.isFetching}>
      {d.periods.length > 1 && (
        <SegmentedControl
          label="Quarter"
          value={d.period ?? ""}
          onChange={setPeriod}
          options={d.periods.map((p) => ({ value: p.value, label: p.label }))}
        />
      )}
      <p className="text-caption text-ink-3">
        {r.period} results{r.basis ? `, ${r.basis}` : ""}.
      </p>
      {r.judgement && (
        <p className="text-body font-medium text-ink">
          {trueMinus(r.judgement)}
        </p>
      )}
      {r.rows.length > 0 && <ResultsTable r={r} />}
      <Block title="Checks">
        <CheckList checks={r.checks} />
      </Block>
      <ChipRow>
        {r.source && <SourceChip source={r.source} />}
        {d.filing_id && (
          <Link
            to={href(d.filing_id)}
            className="press inline-flex min-h-11 items-center rounded-pill border border-rule bg-sheet px-3 text-caption font-medium text-royal hover:bg-ledger"
          >
            Open the filing
          </Link>
        )}
      </ChipRow>
    </div>
  );
}

// ─── Filings ────────────────────────────────────────────────────────────────

const TIER: Record<string, string> = {
  act: "Needs you",
  read: "Worth a look",
  routine: "Routine",
};

function FilingsTab({ symbol }: { symbol: string }) {
  const [page, setPage] = useState(1);
  const f = useQuery(q.filings(symbol, page));
  const href = useSheetHref();
  if (f.isPending) return <Skeleton rows={4} />;
  if (f.isError)
    return <ErrorLine message={f.error.message} onRetry={() => f.refetch()} />;
  const d = f.data.data;
  if (d.events.length === 0)
    return <p className="text-body text-ink-2">{d.note}</p>;
  const turn = (p: number) => {
    setPage(p);
    window.scrollTo({ top: 0 });
  };
  return (
    <div className="space-y-3">
      <p className="text-caption text-ink-3">
        {d.total} event{d.total === 1 ? "" : "s"} in the last 30 days.
      </p>
      <ul className="divide-y divide-rule" aria-busy={f.isFetching}>
        {d.events.map((e) => (
          <li key={e.filing_id}>
            <Link
              to={href(e.filing_id)}
              className="press -mx-2 flex min-h-14 flex-col justify-center gap-0.5 rounded-btn px-2 py-3 hover:bg-sheet"
            >
              <span className="text-caption text-ink-3">
                {istDate(e.filed_at)}. {TIER[e.tier]}
                {e.filings > 1 ? `. ${e.filings} filings` : ""}
              </span>
              <span
                className={`text-ink ${e.tier === "routine" ? "" : "font-medium"}`}
              >
                {trueMinus(e.headline)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {d.pages > 1 && (
        <nav
          aria-label="Pages"
          className="flex items-center justify-between gap-2"
        >
          <button
            type="button"
            disabled={page === 1}
            onClick={() => turn(page - 1)}
            className="press h-11 rounded-btn border border-rule bg-sheet px-4 font-medium text-royal hover:bg-ledger disabled:invisible"
          >
            Newer
          </button>
          <span className="text-caption text-ink-3">
            Page {page} of {d.pages}
          </span>
          <button
            type="button"
            disabled={page >= d.pages}
            onClick={() => turn(page + 1)}
            className="press h-11 rounded-btn border border-rule bg-sheet px-4 font-medium text-royal hover:bg-ledger disabled:invisible"
          >
            Older
          </button>
        </nav>
      )}
    </div>
  );
}

// ─── Research ───────────────────────────────────────────────────────────────

function ResearchTab({
  symbol,
  onStart,
  canStart,
}: {
  symbol: string;
  onStart: () => void;
  canStart: boolean;
}) {
  const fin = useQuery(q.financials(symbol));
  const [seg, setSeg] = useState<"cash" | "trajectory" | "risks">("cash");
  const [table, setTable] = useState(false);
  if (fin.isPending) return <Skeleton rows={4} />;
  if (fin.isError)
    return (
      <ErrorLine message={fin.error.message} onRetry={() => fin.refetch()} />
    );
  const d = fin.data.data;
  const empty = d.cash.length === 0 && d.trajectory.length === 0;
  const tableBtn = (
    <button
      type="button"
      onClick={() => setTable((t) => !t)}
      aria-pressed={table}
      className="press h-11 rounded-btn px-2 text-caption font-medium text-royal hover:bg-ledger"
    >
      {table ? "Show chart" : "Show table"}
    </button>
  );
  const th = "py-2 text-right font-medium";
  return (
    <div className="space-y-5">
      <SegmentedControl
        label="Research"
        value={seg}
        onChange={setSeg}
        options={[
          { value: "cash", label: "Cash quality" },
          { value: "trajectory", label: "Trajectory" },
          { value: "risks", label: "Risks" },
        ]}
      />
      {empty && seg !== "risks" ? (
        <div className="space-y-3">
          <Pending>
            No annual figures on file yet. Research reads them from Screener.
          </Pending>
          {canStart && (
            <button
              type="button"
              onClick={onStart}
              className="press h-11 rounded-btn bg-royal px-4 font-medium text-white"
            >
              Read primary sources
            </button>
          )}
        </div>
      ) : seg === "cash" ? (
        <div className="space-y-3">
          <div className="flex justify-end">{tableBtn}</div>
          {table ? (
            <table className="w-full text-num">
              <caption className="sr-only">
                Operating cash flow and profit by year, ₹ crore
              </caption>
              <thead>
                <tr className="bg-ledger text-caption text-ink-2">
                  <th
                    scope="col"
                    className="rounded-l-[6px] py-2 pl-2 text-left font-medium"
                  >
                    Year
                  </th>
                  <th scope="col" className={th}>
                    CFO
                  </th>
                  <th scope="col" className={th}>
                    PAT
                  </th>
                  <th scope="col" className={`${th} rounded-r-[6px] pr-2`}>
                    CFO ÷ PAT
                  </th>
                </tr>
              </thead>
              <tbody>
                {d.cash.map((r) => (
                  <tr
                    key={r.fy}
                    className="border-b border-rule last:border-b-0"
                  >
                    <th
                      scope="row"
                      className="py-2.5 pl-2 text-left font-normal text-ink-2"
                    >
                      {r.fy}
                    </th>
                    <td className="py-2.5 text-right">
                      {r.cfo === null ? "–" : num(r.cfo)}
                    </td>
                    <td className="py-2.5 text-right">
                      {r.pat === null ? "–" : num(r.pat)}
                    </td>
                    <td className="py-2.5 pr-2 text-right font-medium">
                      {r.ratio === null ? "–" : `${r.ratio.toFixed(2)}×`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <CashBars rows={d.cash} />
          )}
          <ChipRow>
            <SourceChip
              source={{ label: d.source.label, url: d.source.url, page: null }}
            />
          </ChipRow>
        </div>
      ) : seg === "trajectory" ? (
        <div className="space-y-4">
          <div className="flex justify-end">{tableBtn}</div>
          {table ? (
            <table className="w-full text-num">
              <caption className="sr-only">
                Revenue, EBITDA margin and ROCE by year
              </caption>
              <thead>
                <tr className="bg-ledger text-caption text-ink-2">
                  <th
                    scope="col"
                    className="rounded-l-[6px] py-2 pl-2 text-left font-medium"
                  >
                    Year
                  </th>
                  <th scope="col" className={th}>
                    Revenue ₹ cr
                  </th>
                  <th scope="col" className={th}>
                    Margin
                  </th>
                  <th scope="col" className={`${th} rounded-r-[6px] pr-2`}>
                    ROCE
                  </th>
                </tr>
              </thead>
              <tbody>
                {d.trajectory.map((r) => (
                  <tr
                    key={r.fy}
                    className="border-b border-rule last:border-b-0"
                  >
                    <th
                      scope="row"
                      className="py-2.5 pl-2 text-left font-normal text-ink-2"
                    >
                      {r.fy}
                    </th>
                    <td className="py-2.5 text-right">
                      {r.revenue === null ? "–" : num(r.revenue)}
                    </td>
                    <td className="py-2.5 text-right">
                      {r.ebitda_margin === null
                        ? "–"
                        : `${r.ebitda_margin.toFixed(1)}%`}
                    </td>
                    <td className="py-2.5 pr-2 text-right">
                      {r.roce === null ? "–" : `${r.roce.toFixed(1)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <>
              <MiniLine
                title="Revenue"
                unit="cr"
                points={d.trajectory.map((r) => ({ fy: r.fy, v: r.revenue }))}
              />
              <MiniLine
                title="EBITDA margin"
                unit="pct"
                points={d.trajectory.map((r) => ({
                  fy: r.fy,
                  v: r.ebitda_margin,
                }))}
              />
              <MiniLine
                title="ROCE"
                unit="pct"
                points={d.trajectory.map((r) => ({ fy: r.fy, v: r.roce }))}
              />
            </>
          )}
          <p className="text-caption text-ink-3">{d.roce_note}</p>
          <ChipRow>
            <SourceChip
              source={{ label: d.source.label, url: d.source.url, page: null }}
            />
          </ChipRow>
        </div>
      ) : d.risks ? (
        <div className="space-y-6">
          {(
            [
              ["What could go wrong", d.risks.down],
              ["What could go right", d.risks.up],
            ] as const
          ).map(([title, items]) => (
            <Block key={title} title={title}>
              <ul className="space-y-4">
                {items.map((x, i) => (
                  <li key={i} className="space-y-1.5">
                    <p className="text-body text-ink">{x.text}</p>
                    {cite(x.source)}
                  </li>
                ))}
              </ul>
            </Block>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          <Pending>{d.risks_note}</Pending>
          {d.annual_report && (
            <ChipRow>
              <SourceChip
                source={{
                  label: d.annual_report.label,
                  url: d.annual_report.url,
                  page: null,
                }}
              />
            </ChipRow>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export function CompanyPage() {
  const { symbol: raw = "", tab: rawTab } = useParams();
  const symbol = raw.toUpperCase();
  // "record" was this tab's old address; links to it still land here.
  const want = rawTab === "record" ? "guidance" : rawTab;
  const tab: TabId = TABS.some((t) => t.id === want)
    ? (want as TabId)
    : "overview";
  const co = useQuery(q.company(symbol));
  const d = co.data?.data;
  const research = useResearch(
    symbol,
    d,
    co.isFetchedAfterMount && !co.isFetching,
  );

  if (co.isPending) return <Skeleton hero rows={3} />;
  if (co.isError)
    return (
      <ErrorLine message={co.error.message} onRetry={() => co.refetch()} />
    );
  const data = d!;

  return (
    <div className="space-y-5">
      <Header d={data} />

      {(research.running || research.starting) && (
        <Reading
          name={data.header.name}
          job={research.job}
          starting={research.starting}
        />
      )}
      {(research.job?.status === "failed" ||
        research.startError ||
        data.research.status === "failed") &&
        !research.running && (
          <div className="space-y-2">
            <p className="text-body text-ink-2">
              Couldn't research {symbol}:{" "}
              {research.job?.error ??
                research.startError?.message ??
                data.research.error ??
                "the job stopped"}
              .
            </p>
            <button
              type="button"
              onClick={research.start}
              className="press h-11 rounded-btn border border-rule bg-sheet px-4 font-medium text-royal hover:bg-ledger"
            >
              Try again
            </button>
          </div>
        )}
      {data.research.status === "none" &&
        !research.running &&
        !research.starting &&
        !research.job && (
          <div className="flex items-center justify-between gap-3 rounded-card bg-ledger px-4 py-3">
            <p className="text-caption text-ink-2">
              Not researched yet: annual report, calls and five years of
              numbers.
            </p>
            <button
              type="button"
              onClick={research.start}
              className="press h-11 shrink-0 rounded-btn bg-royal px-4 text-caption font-medium text-white"
            >
              Read sources
            </button>
          </div>
        )}

      {/* Sticky tabs under the top bar; they scroll sideways on narrow screens. */}
      <nav
        aria-label={`${symbol} sections`}
        className="sticky z-10 -mx-4 border-b border-rule bg-paper sm:-mx-6"
        style={{ top: "var(--topbar-h, 0px)" }}
      >
        <ul className="flex overflow-x-auto px-4 [scrollbar-width:none] sm:px-6">
          {TABS.map((t) => (
            <li key={t.id} className="flex-auto">
              <NavLink
                to={`/c/${symbol}${t.id === "overview" ? "" : `/${t.id}`}`}
                replace
                end
                aria-current={tab === t.id ? "page" : undefined}
                className={`press flex h-11 items-center justify-center whitespace-nowrap border-b-2 px-1.5 text-caption font-medium ${tab === t.id ? "border-ink font-semibold text-ink" : "border-transparent text-ink-2 hover:text-ink"}`}
              >
                {t.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div>
        {tab === "overview" && <Overview d={data} />}
        {tab === "guidance" && (
          <GuidanceTab
            symbol={symbol}
            name={shortName(data.header.name)}
            research={data.research}
          />
        )}
        {tab === "results" && <ResultsTab symbol={symbol} />}
        {tab === "filings" && <FilingsTab symbol={symbol} />}
        {tab === "research" && (
          <ResearchTab
            symbol={symbol}
            onStart={research.start}
            canStart={data.research.status === "none" && !research.running}
          />
        )}
      </div>
    </div>
  );
}
