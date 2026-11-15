import { useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { MessageCircleQuestion } from "lucide-react";
import { api } from "../lib/api";
import { cleanReasons, istDate, shortName, trueMinus, weight } from "../lib/format";
import { q, type AskData, type ConcallDetail, type ItemData, type PeopleDetail, type ResultsDetail } from "../lib/queries";
import { ChipRow, CheckList, QuoteBlock, ResultsTable, SourceChip } from "./Evidence";
import { RecordStrip } from "./RecordStrip";
import { Sheet } from "./Sheet";

const KIND_LABEL: Record<ItemData["kind"], string> = {
  results: "Results",
  people: "Management change",
  concall: "Earnings call",
  filing: "Filing",
};

function Block({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      {title && <h3 className="text-caption font-semibold uppercase tracking-[0.04em] text-ink-3">{title}</h3>}
      {children}
    </section>
  );
}

/** A quiet line for what FINN hasn't read yet. Said plainly, never dressed up as data. */
const Pending = ({ children }: { children: ReactNode }) => <p className="rounded-btn bg-ledger px-3 py-2 text-caption text-ink-2">{children}</p>;

function ResultsBody({ r }: { r: ResultsDetail }) {
  return (
    <>
      {r.judgement && <p className="text-body font-medium text-ink">{trueMinus(r.judgement)}</p>}
      {r.rows.length > 0 && <ResultsTable r={r} />}
      <Block title="Checks">
        <CheckList checks={r.checks} />
      </Block>
    </>
  );
}

function PeopleBody({ p }: { p: PeopleDetail }) {
  return (
    <>
      {p.people.map((x) => (
        <Block key={`${x.name}-${x.action}`}>
          <p className="text-body">
            <span className="font-medium text-ink">{x.name}</span>
            <span className="text-ink-2">. {x.role}.</span>
          </p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-caption">
            <dt className="text-ink-3">Change</dt>
            <dd className="text-ink">
              {x.action}
              {x.effective_date ? `, effective ${istDate(x.effective_date)}` : ""}
            </dd>
            {x.tenure_months !== null && (
              <>
                <dt className="text-ink-3">Tenure</dt>
                <dd className="text-ink">{x.tenure_months >= 12 ? `${Math.round(x.tenure_months / 12)} years` : `${x.tenure_months} months`}</dd>
              </>
            )}
            {x.stated_reason && (
              <>
                <dt className="text-ink-3">Stated reason</dt>
                <dd className="text-ink">{x.stated_reason}</dd>
              </>
            )}
          </dl>
          {x.prior_roles.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-5 text-caption text-ink-2">
              {x.prior_roles.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
        </Block>
      ))}
      <Block title="Last 12 months">
        <p className="text-body text-ink">{p.senior_exit_line}</p>
      </Block>
      {p.note && <Pending>{p.note}</Pending>}
    </>
  );
}

const REVISION: Record<ConcallDetail["revisions"][number]["status"], string> = {
  raised: "Raised",
  lowered: "Lowered",
  changed: "Changed",
  dropped: "Dropped",
  new: "New",
  unchanged: "Unchanged",
};

function ConcallBody({ c, item }: { c: ConcallDetail; item: ItemData }) {
  const callSource = (page: number, call = c.call) => {
    const url = c.transcript_url ?? item.sources[0]?.url;
    return url ? { label: `${call} call, p.${page}`, url, page } : null;
  };
  return (
    <>
      <Block title="Record">
        <p className="flex flex-wrap items-baseline gap-x-3 text-body text-ink">
          {item.record ? <RecordStrip record={item.record} withLine /> : c.credibility}
        </p>
      </Block>
      {c.revisions.length > 0 && (
        <Block title={c.previous_call ? `Against the ${c.previous_call} call` : "Guidance on this call"}>
          <ul className="divide-y divide-rule">
            {c.revisions.slice(0, 6).map((r) => (
              <li key={`${r.metric}-${r.period}-${r.status}`} className="py-2 text-body">
                <span className="font-medium text-ink">{REVISION[r.status]}: </span>
                <span className="text-ink">
                  {r.metric}
                  {r.period ? ` ${r.period}` : ""} {r.from && r.to ? `${r.from} → ${r.to}` : (r.to ?? r.from ?? "")}
                </span>
              </li>
            ))}
          </ul>
        </Block>
      )}
      {c.quotes.length > 0 && (
        <Block title="In management's words">
          <div className="space-y-4">
            {c.quotes.map((x) => (
              <QuoteBlock key={`${x.page}-${x.quote.slice(0, 20)}`} quote={x.quote} source={callSource(x.page)} />
            ))}
          </div>
        </Block>
      )}
      {c.note && <Pending>{c.note}</Pending>}
    </>
  );
}

function renderAnswerText(text: string) {
  const urlRegex = /(https?:\/\/[^\s\)]+)/g;
  const parts = text.split(urlRegex);
  return (
    <span>
      {parts.map((part, i) => {
        if (/^https?:\/\//.test(part)) {
          const isLinkedIn = part.includes("linkedin.com");
          return (
            <a
              key={i}
              href={part}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium text-royal underline underline-offset-2 hover:opacity-80"
            >
              {isLinkedIn ? "View on LinkedIn ↗" : part}
            </a>
          );
        }
        return part;
      })}
    </span>
  );
}

function AskBox({ symbol, name }: { symbol: string; name: string }) {
  const [question, setQuestion] = useState("");
  const ask = useMutation({
    mutationFn: (question: string) => api<AskData>("/v1/ask", { method: "POST", body: JSON.stringify({ symbol, question }) }),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (question.trim().length >= 5) ask.mutate(question.trim());
  };
  const a = ask.data?.data;
  return (
    <form onSubmit={submit} className="space-y-2">
      <label htmlFor="ask-input" className="block text-caption font-medium text-ink-2">
        Ask about {name}, answered only from its filings and calls
      </label>
      <div className="flex gap-2">
        <input
          id="ask-input"
          autoFocus
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Why did margins fall?"
          maxLength={500}
          className="h-11 min-w-0 flex-1 rounded-btn border border-rule bg-sheet px-3 text-body text-ink placeholder:text-ink-3 focus:border-royal"
        />
        <button type="submit" disabled={ask.isPending || question.trim().length < 5} className="press h-11 shrink-0 rounded-btn bg-royal px-4 font-medium text-white disabled:opacity-50">
          {ask.isPending ? "Asking" : "Ask"}
        </button>
      </div>
      {ask.isError && <p className="text-caption text-behind-text">{ask.error.message}</p>}
      {a && (a.refused ? <p className="text-caption text-ink-2">{a.reason}</p> : <div className="text-body text-ink">{renderAnswerText(a.answer ?? "")}</div>)}
      {a?.citations && a.citations.length > 0 && (
        <ChipRow>
          {a.citations.filter((c) => c.url).map((c) => (
            <SourceChip key={c.n} source={{ label: c.label, url: c.url!, page: c.page }} />
          ))}
        </ChipRow>
      )}
    </form>
  );
}

/**
 * The item sheet: a filing's detail over the page. Results get the table and checks; a management
 * change gets who, what and the 12-month exit count; an earnings call gets guidance changes and
 * management's own words with pages.
 */
export function ItemSheet({ id, onClose }: { id: number; onClose: () => void }) {
  const item = useQuery(q.item(id));
  const navigate = useNavigate();
  const [asking, setAsking] = useState(false);
  const d = item.data?.data;
  const name = d ? shortName(d.name) : "Loading";

  const subtitle = d
    ? [d.results ? `${d.results.period} results${d.results.basis ? `, ${d.results.basis}` : ""}` : KIND_LABEL[d.kind], istDate(d.filed_at), d.weight_pct !== null ? `${weight(d.weight_pct)} of book` : null]
        .filter(Boolean)
        .join(". ")
    : undefined;

  const sources = d ? [...(d.results?.source ? [d.results.source] : d.sources)] : [];

  return (
    <Sheet
      title={d ? shortName(d.name) : "Loading"}
      subtitle={subtitle}
      onClose={onClose}
      tall
      footer={
        d && (
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setAsking((x) => !x)} aria-expanded={asking} className="press inline-flex h-11 items-center justify-center gap-1.5 rounded-btn border border-rule bg-sheet font-medium text-royal hover:bg-ledger">
              <MessageCircleQuestion size={17} strokeWidth={1.75} aria-hidden="true" />
              Ask about this
            </button>
            <button type="button" onClick={() => navigate(`/c/${d.symbol}`)} className="press h-11 truncate rounded-btn bg-royal px-3 font-medium text-white hover:bg-royal/90">
              Open {name}
            </button>
          </div>
        )
      }
    >
      {item.isPending && (
        <div aria-busy="true" aria-label="Loading" className="space-y-4">
          <div className="h-5 w-4/5 rounded-[4px] bg-ledger" />
          <div className="h-40 rounded-[6px] bg-ledger" />
          <div className="h-4 w-2/3 rounded-[4px] bg-ledger" />
        </div>
      )}
      {item.isError && <p className="text-body text-ink-2">{item.error.message}</p>}
      {d && (
        <div className="space-y-6">
          <section className="space-y-1">
            <p className="text-body font-semibold text-ink">{trueMinus(d.headline)}</p>
            <p className="text-caption text-ink-2">{trueMinus(cleanReasons(d.reasons, d.headline).join(". "))}.</p>
          </section>

          {d.results && <ResultsBody r={d.results} />}
          {d.people && <PeopleBody p={d.people} />}
          {d.concall && <ConcallBody c={d.concall} item={d} />}
          {d.kind !== "concall" && d.record && (
            <Block title="Management record">
              <p className="text-body">
                <RecordStrip record={d.record} withLine />
              </p>
            </Block>
          )}

          {d.related.length > 0 && (
            <Block title="Filed with it">
              <ul className="divide-y divide-rule">
                {d.related.map((r) => (
                  <li key={r.id} className="py-2 text-body text-ink">
                    {trueMinus(r.headline)} <span className="text-caption text-ink-3">{istDate(r.filed_at)}</span>
                  </li>
                ))}
              </ul>
            </Block>
          )}

          {sources.length > 0 && (
            <Block title="Sources">
              <ChipRow>
                {sources.map((s) => (
                  <SourceChip key={s.url} source={s} />
                ))}
              </ChipRow>
            </Block>
          )}

          {asking && <AskBox symbol={d.symbol} name={name} />}
        </div>
      )}
    </Sheet>
  );
}
