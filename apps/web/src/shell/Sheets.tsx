import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { ChevronRight, ExternalLink, RotateCcw, Scale, Shield } from "lucide-react";
import { Switch } from "../components/Controls";
import { SegmentedControl } from "../components/SegmentedControl";
import { Sheet } from "../components/Sheet";
import { api } from "../lib/api";
import { num } from "../lib/format";
import { bustCache, q, type MethodData, type SettingsData } from "../lib/queries";

// ─── Reviewer Guide: FINN in two minutes ──────────────────────────────────────

interface GuideStep {
  num: number;
  title: string;
  where: string;
  description: string;
  target: string;
}

export function ReviewerGuide({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const brief = useQuery(q.brief());
  const allBrief = [
    ...(brief.data?.data.segments?.act ?? []),
    ...(brief.data?.data.segments?.read ?? []),
    ...(brief.data?.data.items ?? []),
  ];
  const topResults = allBrief.find((i) => i.category === "results" || (i as any).sub_kind === "results") ?? allBrief[0];
  const resultsTarget = topResults ? `/brief?sheet=item:${topResults.filing_id}` : "/brief?seg=read";

  const steps: GuideStep[] = [
    { num: 1, title: "See what to review today", where: "Feed → Needs you", description: "Filings ranked by how much they matter to your holdings, each with the reason.", target: "/brief?seg=act" },
    { num: 2, title: "Open a results card", where: "Feed → a results filing", description: "Revenue, EBITDA and profit with QoQ and YoY, and the checks that the numbers add up.", target: resultsTarget },
    { num: 3, title: "Decide what counts as unusual", where: "Alerts → Rules", description: "Change the thresholds and see how many alerts they would have fired in the last 30 days.", target: "/alerts?seg=rules" },
    { num: 4, title: "Check management's promises", where: "Company → Guidance", description: "What management promised on each call, what they delivered, and the page it came from.", target: "/c/KPITTECH/guidance" },
    { num: 5, title: "Research a company you don't hold", where: "Research", description: "Pick any NSE company and watch FINN read its annual report and calls.", target: "/research" },
    { num: 6, title: "See how FINN decides", where: "Settings → How FINN decides", description: "The ranking rules, the formulas, which model does what, and what it has cost.", target: "?sheet=settings" },
  ];

  const go = (target: string) => {
    onClose();
    if (target.startsWith("?")) {
      navigate({ search: target }, { replace: true });
    } else {
      navigate(target);
    }
  };

  return (
    <Sheet title="FINN in two minutes" subtitle="Interactive guide for evaluators" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-body text-ink-2">
          FINN tells you what changed in your holdings today, and checks what management promised against what it delivered.
        </p>

        <ol className="divide-y divide-rule rounded-card border border-rule bg-sheet">
          {steps.map((s) => (
            <li key={s.num}>
              <button
                type="button"
                onClick={() => go(s.target)}
                className="press flex w-full items-start gap-3.5 p-3.5 text-left hover:bg-ledger"
              >
                <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-pill bg-royal text-caption font-semibold text-white">
                  {s.num}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="font-medium text-ink">{s.title}</span>
                    <span className="shrink-0 text-caption font-medium text-royal">{s.where}</span>
                  </span>
                  <span className="mt-0.5 block text-caption text-ink-2">{s.description}</span>
                </span>
                <ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" className="mt-1 shrink-0 text-ink-3" />
              </button>
            </li>
          ))}
        </ol>

        <div className="rounded-btn bg-ledger p-3 text-caption text-ink-3">
          Tip: Tap any step above to immediately navigate to that screen with real primary data.
        </div>
      </div>
    </Sheet>
  );
}

// ─── Settings Drawer ──────────────────────────────────────────────────────────

const EXCLUSION_META: Record<string, { label: string; desc: string }> = {
  alcohol: { label: "Alcoholic beverages", desc: "Breweries, distilleries, liquor, beer, wine" },
  tobacco: { label: "Tobacco products", desc: "Cigarettes, cigars, bidi, gutkha, nicotine" },
  gambling: { label: "Gambling & betting", desc: "Casinos, lotteries, wagering operations" },
  real_money_gaming: { label: "Real-money gaming", desc: "Online RMG, fantasy sports, rummy, poker" },
  animal_harm: { label: "Animal harm", desc: "Leather, tanneries, slaughterhouses, meat processing" },
};

function HouseViewSection({
  settings,
  onSave,
  onUnmute,
  saving,
}: {
  settings: SettingsData;
  onSave: (patch: Partial<SettingsData["house_view"]>) => void;
  onUnmute: (subKind: string) => void;
  saving: boolean;
}) {
  const hv = settings.house_view;
  const currentExcluded = new Set(hv.mandate.excluded_activities);

  const toggleActivity = (act: string, active: boolean) => {
    const next = new Set(currentExcluded);
    if (active) next.add(act);
    else next.delete(act);
    onSave({
      mandate: {
        ...hv.mandate,
        excluded_activities: [...next],
      },
    });
  };

  return (
    <div className="space-y-6">
      <section className="space-y-3" aria-labelledby="materiality-rules">
        <div className="flex items-center gap-2">
          <Scale size={18} strokeWidth={1.75} className="text-royal" aria-hidden="true" />
          <h3 id="materiality-rules" className="text-section font-semibold text-ink">
            Materiality rules
          </h3>
        </div>
        <div className="rounded-card border border-rule bg-sheet p-4 space-y-3">
          <p className="text-body text-ink">
            <span className="font-semibold text-royal">Act tier:</span> Score ≥ {settings.materiality.act_threshold} or an Always-Act override.
          </p>
          <div className="space-y-1.5 border-t border-rule pt-3 text-caption text-ink-2">
            <p className="font-medium text-ink">Always-Act triggers (pure code, never a guess):</p>
            <ul className="list-disc pl-4 space-y-1">
              {settings.materiality.always_act.map((item, idx) => (
                <li key={idx}>{item}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="ethical-exclusions">
        <div className="flex items-center gap-2">
          <Shield size={18} strokeWidth={1.75} className="text-royal" aria-hidden="true" />
          <h3 id="ethical-exclusions" className="text-section font-semibold text-ink">
            Ethical exclusions checklist
          </h3>
        </div>
        <p className="text-caption text-ink-3">
          Annual report segment notes and acquisitions are scanned against these categories.
        </p>

        <div className="divide-y divide-rule rounded-card border border-rule bg-sheet">
          {Object.entries(EXCLUSION_META).map(([key, meta]) => {
            const isChecked = currentExcluded.has(key);
            return (
              <div key={key} className="flex items-center justify-between gap-3 p-3.5">
                <span className="min-w-0">
                  <span className="block font-medium text-ink">{meta.label}</span>
                  <span className="block text-caption text-ink-3">{meta.desc}</span>
                </span>
                <Switch
                  label={meta.label}
                  checked={isChecked}
                  onChange={(checked) => toggleActivity(key, checked)}
                />
              </div>
            );
          })}
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="muted-kinds">
        <h3 id="muted-kinds" className="text-section font-semibold text-ink">
          Muted filing types ({hv.muted_sub_kinds.length})
        </h3>
        {hv.muted_sub_kinds.length === 0 ? (
          <p className="text-body text-ink-3">No filing types are currently muted.</p>
        ) : (
          <ul className="divide-y divide-rule rounded-card border border-rule bg-sheet">
            {hv.muted_sub_kinds.map((sk) => (
              <li key={sk} className="flex items-center justify-between gap-3 p-3.5">
                <span className="text-body text-ink capitalize">{sk.replace(/_/g, " ")}</span>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => onUnmute(sk)}
                  className="press inline-flex h-9 items-center gap-1 rounded-btn border border-rule px-3 text-caption font-medium text-royal hover:bg-ledger disabled:opacity-50"
                >
                  <RotateCcw size={14} strokeWidth={1.75} aria-hidden="true" />
                  Unmute
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function HowFinnDecidesSection({ method }: { method: MethodData | undefined }) {
  if (!method) {
    return <div className="space-y-3">{[0, 1, 2, 3].map((i) => <div key={i} className="h-6 rounded bg-ledger animate-pulse" />)}</div>;
  }

  const m = method;

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h4 className="text-caption font-semibold uppercase tracking-[0.04em] text-ink-3">Ranking logic</h4>
        <div className="rounded-card border border-rule bg-sheet p-4 space-y-2 text-body">
          <p className="text-ink">
            <strong>Rules first, model fallback:</strong> Every filing is classified by deterministic regex rules on exchange subject and category. The tier-1 model only runs when rules conflict.
          </p>
          <p className="text-caption text-ink-2">
            Score = Category base (0–70) + Position weight (0–10) + Stock price move (0–20). Score ≥ 80 = Act tier.
          </p>
        </div>
      </section>

      <section className="space-y-2">
        <h4 className="text-caption font-semibold uppercase tracking-[0.04em] text-ink-3">Conservative EBITDA formula</h4>
        <div className="rounded-card border border-rule bg-sheet p-4 space-y-2">
          <code className="block rounded bg-ledger p-2.5 font-mono text-caption text-ink font-semibold">
            {m.formulas.ebitda}
          </code>
          <p className="text-caption text-ink-2">
            Other income is stripped out so operational profit cannot be masked. Exceptional items are quarantined in PBT.
          </p>
        </div>
      </section>

      <section className="space-y-2">
        <h4 className="text-caption font-semibold uppercase tracking-[0.04em] text-ink-3">Primary data sources</h4>
        <ul className="rounded-card border border-rule bg-sheet divide-y divide-rule text-body">
          <li className="p-3">
            <strong className="text-ink">NSE & BSE:</strong> Raw regulatory announcements fetched with cookie handshake and auto-fallback.
          </li>
          <li className="p-3">
            <strong className="text-ink">Yahoo Finance:</strong> 60 sessions of unadjusted closing prices and volume for holding reactions.
          </li>
          <li className="p-3">
            <strong className="text-ink">Screener.in:</strong> Consolidated quarterly tables and 5-year annual reports for arithmetic tie checks.
          </li>
        </ul>
      </section>

      <section className="space-y-2">
        <h4 className="text-caption font-semibold uppercase tracking-[0.04em] text-ink-3">4-Tier Model Router</h4>
        <div className="rounded-card border border-rule bg-sheet divide-y divide-rule text-caption">
          <div className="p-3 bg-ledger/60">
            <span className="font-semibold text-ink">Tier 0 (Code):</span> 0 tokens, ₹0. Arithmetic, scoring, regex, grouping, and verdicts.
          </div>
          <div className="p-3">
            <span className="font-semibold text-ink">Tier 1 (Cheap):</span> gemini-3.1-flash-lite (failover: Groq). Filing classification & meeting dates.
          </div>
          <div className="p-3">
            <span className="font-semibold text-ink">Tier 2 (Mid):</span> gemini-3.5-flash. Results table OCR fallback, people profiles, guidance extraction.
          </div>
          <div className="p-3">
            <span className="font-semibold text-ink">Tier 3 (Strong):</span> gemini-2.5-pro / Claude. Synthesis, downside risks, questions for management.
          </div>
        </div>
      </section>

      <section className="space-y-2">
        <h4 className="text-caption font-semibold uppercase tracking-[0.04em] text-ink-3">Compute transparency & INR cost</h4>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-btn border border-rule bg-sheet p-3 text-center">
            <span className="block text-hero font-semibold text-ink">₹{num(m.costs.total_inr, 2)}</span>
            <span className="text-caption text-ink-3">Total compute cost</span>
          </div>
          <div className="rounded-btn border border-rule bg-sheet p-3 text-center">
            <span className="block text-hero font-semibold text-royal">{num(m.costs.calls)}</span>
            <span className="text-caption text-ink-3">Total API calls</span>
          </div>
          <div className="rounded-btn border border-rule bg-sheet p-3 text-center">
            <span className="block text-hero font-semibold text-met">{num(m.costs.cached_calls)}</span>
            <span className="text-caption text-ink-3">Cache hits (₹0)</span>
          </div>
          <div className="rounded-btn border border-rule bg-sheet p-3 text-center">
            <span className="block text-hero font-semibold text-ink">
              {m.costs.calls > 0 ? Math.round((m.costs.cached_calls / m.costs.calls) * 100) : 0}%
            </span>
            <span className="text-caption text-ink-3">Cache ratio</span>
          </div>
        </div>
      </section>
    </div>
  );
}

function AboutSection() {
  const health = useQuery(q.health());
  const sources = health.data?.data.sources ?? [];

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h4 className="text-caption font-semibold uppercase tracking-[0.04em] text-ink-3">Data feed status</h4>
        <div className="divide-y divide-rule rounded-card border border-rule bg-sheet text-body">
          {sources.map((s) => (
            <div key={s.source} className="flex items-center justify-between p-3.5">
              <span className="font-medium text-ink capitalize">{s.source}</span>
              <span className="text-caption text-ink-2">{s.note}</span>
            </div>
          ))}
          {sources.length === 0 && <p className="p-3 text-caption text-ink-3">Checking feed health…</p>}
        </div>
      </section>

      <section className="space-y-2">
        <h4 className="text-caption font-semibold uppercase tracking-[0.04em] text-ink-3">Architecture & Codebase</h4>
        <div className="rounded-card border border-rule bg-sheet p-4 space-y-3 text-body">
          <p className="text-ink">
            FINN is built with pure TypeScript, Hono, Node.js 22, React 19, Tailwind CSS, TanStack Query, and Supabase Postgres in Mumbai (ap-south-1).
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <a
              href="https://github.com/enam-finn/finn"
              target="_blank"
              rel="noopener noreferrer"
              className="press inline-flex h-10 items-center gap-1.5 rounded-btn border border-rule bg-ledger px-3.5 text-caption font-medium text-royal hover:bg-rule/60"
            >
              <ExternalLink size={15} strokeWidth={1.75} aria-hidden="true" />
              Source repository
            </a>
          </div>
        </div>
      </section>

      <section className="space-y-1 text-caption text-ink-3">
        <p>FINN v2.1 · Built for institutional fund managers</p>
        <p>Server region: Mumbai (bom1) · Indian Standard Time (IST UTC+05:30)</p>
      </section>
    </div>
  );
}

export function SettingsSheet({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"house" | "method" | "about">("house");

  const settingsQ = useQuery(q.settings());
  const methodQ = useQuery(q.method());

  const saveMutation = useMutation({
    mutationFn: (patch: Partial<SettingsData["house_view"]>) =>
      api<{ saved: boolean }>("/v1/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      }),
    onSuccess: () => {
      bustCache();
      void qc.invalidateQueries({ queryKey: ["settings"] });
      void qc.invalidateQueries({ queryKey: ["holdings"] });
      void qc.invalidateQueries({ queryKey: ["brief"] });
    },
  });

  const unmuteMutation = useMutation({
    mutationFn: (subKind: string) =>
      api<{ saved: boolean }>("/v1/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "unmute_kind", sub_kind: subKind }),
      }),
    onSuccess: () => {
      bustCache();
      void qc.invalidateQueries({ queryKey: ["settings"] });
      void qc.invalidateQueries({ queryKey: ["brief"] });
    },
  });

  const s = settingsQ.data?.data;

  return (
    <Sheet title="Settings & Architecture" subtitle="House view, formulas, and transparency" onClose={onClose}>
      <div className="space-y-5">
        <SegmentedControl
          label="Settings tab"
          value={tab}
          onChange={setTab}
          options={[
            { value: "house", label: "House view" },
            { value: "method", label: "How FINN decides" },
            { value: "about", label: "About" },
          ]}
        />

        {tab === "house" && s && (
          <HouseViewSection
            settings={s}
            onSave={(patch) => saveMutation.mutate(patch)}
            onUnmute={(sk) => unmuteMutation.mutate(sk)}
            saving={saveMutation.isPending || unmuteMutation.isPending}
          />
        )}
        {tab === "house" && !s && (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-12 rounded-card bg-ledger animate-pulse" />
            ))}
          </div>
        )}

        {tab === "method" && <HowFinnDecidesSection method={methodQ.data?.data} />}

        {tab === "about" && <AboutSection />}
      </div>
    </Sheet>
  );
}
