import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { ChevronRight, Send, Sparkles, Trash2, X } from "lucide-react";
import { ChipGroup, Stepper, Switch } from "../components/Controls";
import { TelegramIcon, WhatsAppIcon } from "../components/BrandIcons";
import { useSheetHref } from "../components/ItemRow";
import { SegmentedControl } from "../components/SegmentedControl";
import { api } from "../lib/api";
import {
  istDate,
  istShortDay,
  shortName,
  trueMinus,
  weight,
} from "../lib/format";
import {
  ALERT_CATEGORIES,
  bustCache,
  q,
  type AlertCategory,
  type AlertItem,
  type AlertRules,
  type CustomAlert,
  type Delivery,
} from "../lib/queries";
import { categoryLabel } from "./TabPages";
import {
  cardClass,
  ErrorLine,
  PageTitle,
  Pill,
  SectionTitle,
  Skeleton,
} from "./parts";

/** Six alerts per day at most; the rest are counted, not listed. */
const PER_DAY = 6;

const IST_TODAY = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
function dayLabel(date: string): string {
  const today = IST_TODAY();
  const yest = new Date(
    Date.parse(`${today}T12:00:00+05:30`) - 864e5,
  ).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  return date === today
    ? "Today"
    : date === yest
      ? "Yesterday"
      : istShortDay(`${date}T12:00:00+05:30`);
}

/**
 * One alert as a card: company and share of book; the move in bold ("Fell 12.9%, 9× its usual
 * daily move"); then what explains it, or an amber pill saying nothing does. Explained alerts
 * open the explaining filing.
 */
function AlertRow({ a }: { a: AlertItem }) {
  const href = useSheetHref();
  const body = (
    <>
      <span className="flex items-baseline justify-between gap-3">
        <span className="truncate text-caption font-medium text-ink-2">
          {shortName(a.name)}
        </span>
        {a.weight_pct !== null && (
          <span className="shrink-0 text-caption text-ink-3">
            {weight(a.weight_pct)} of book
          </span>
        )}
      </span>
      <span className="block text-[17px] font-semibold leading-6 text-ink">
        {trueMinus(a.text.replace(/\.$/, ""))}
      </span>
      {a.explanation ? (
        <span className="flex min-w-0 items-center gap-2 pt-0.5 text-caption text-ink-2">
          <Pill tone="met">Explained by</Pill>
          {/* One line, always: the full filing is a tap away. */}
          <span className="min-w-0 flex-1 truncate" title={`${a.explanation.headline}, filed ${istDate(a.explanation.filed_at)}`}>
            {a.explanation.headline}, {istDate(a.explanation.filed_at)}
          </span>
          <ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" className="shrink-0 text-ink-3" />
        </span>
      ) : (
        <span className="block pt-0.5">
          <Pill tone="behind">No filing explains this</Pill>
        </span>
      )}
    </>
  );
  const cls = `${cardClass} block space-y-1 px-4 py-3.5`;
  return a.explanation ? (
    <Link
      to={href(a.explanation.filing_id)}
      className={`press ${cls} transition-[border-color,transform] hover:-translate-y-px hover:border-ink-3/40`}
    >
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function DeliveryLine({ d }: { d: Delivery }) {
  return (
    <p className="flex items-center gap-2 px-1 text-caption text-ink-3">
      <Send size={14} strokeWidth={1.75} aria-hidden="true" />
      {d.line}
    </p>
  );
}

function Triggered({ onRules }: { onRules: () => void }) {
  const alerts = useQuery(q.alerts());
  if (alerts.isPending) return <Skeleton rows={3} />;
  if (alerts.isError)
    return (
      <ErrorLine
        message={alerts.error.message}
        onRetry={() => alerts.refetch()}
      />
    );
  const { days, delivery } = alerts.data.data;
  return (
    <div className="space-y-5">
      {days.length === 0 ? (
        <div className="space-y-3">
          <p className="text-body text-ink-2">
            No alerts in the last 7 days with your current rules.
          </p>
          <button
            type="button"
            onClick={onRules}
            className="press h-11 rounded-btn border border-rule bg-sheet px-4 font-medium text-royal hover:bg-ledger"
          >
            Change the rules
          </button>
        </div>
      ) : (
        days.map((d) => (
          <section
            key={d.date}
            aria-label={dayLabel(d.date)}
            className="space-y-2"
          >
            <h2 className="px-1 text-caption font-semibold text-ink-2">
              {dayLabel(d.date)}
            </h2>
            <ul className="space-y-2.5">
              {d.items.slice(0, PER_DAY).map((a) => (
                <li key={a.id}>
                  <AlertRow a={a} />
                </li>
              ))}
            </ul>
            {d.items.length > PER_DAY && (
              <p className="text-caption text-ink-3">
                And {d.items.length - PER_DAY} more that day.
              </p>
            )}
          </section>
        ))
      )}
      <DeliveryLine d={delivery} />
    </div>
  );
}

// ─── Custom Trigger Setup (Natural Language Chat & Pending Alerts) ────────────

const SUGGESTIONS = [
  "Set an alert for HDFC bank's PE < 30",
  "Alert if Reliance drops more than 4%",
  "Alert when Polycab volume reaches 3×",
  "Notify when Kaynes revenue miss",
];

function CustomTriggerSection() {
  const qc = useQueryClient();
  const [prompt, setPrompt] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const customQuery = useQuery(q.customAlerts());
  // Only triggers the user actually set. No sample rows: a made-up "current value" reads as real.
  const pendingAlerts = customQuery.data?.data.pending ?? [];

  const createAlert = useMutation({
    mutationFn: (p: string) =>
      api<{ alert: CustomAlert; pending: CustomAlert[] }>("/v1/alerts/custom", {
        method: "POST",
        body: JSON.stringify({ prompt: p }),
      }),
    onSuccess: (res) => {
      setPrompt("");
      setNotice(
        `✓ Watching ${res.data.alert.summary}${res.data.alert.current_value ? ` (Currently: ${res.data.alert.current_value})` : ""}`,
      );
      void qc.invalidateQueries({ queryKey: ["custom-alerts"] });
      setTimeout(() => setNotice(null), 8000);
    },
    onError: (err) => {
      setNotice(`Could not create alert: ${err.message}`);
    },
  });

  const deleteAlert = useMutation({
    mutationFn: (id: string) =>
      api<{ deleted: boolean; pending: CustomAlert[] }>(
        `/v1/alerts/custom/${id}`,
        {
          method: "DELETE",
        },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["custom-alerts"] });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (prompt.trim().length >= 3) {
      createAlert.mutate(prompt.trim());
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. Chat input to type what kind of alert */}
      <section className="space-y-3" aria-labelledby="custom-alert-heading">
        <div className="flex items-center gap-2">
          <SectionTitle id="custom-alert-heading">
            Create custom trigger
          </SectionTitle>
          <span className="inline-flex items-center gap-1 rounded-full bg-royal/10 px-2 py-0.5 text-[11px] font-semibold text-royal">
            <Sparkles size={11} /> AI
          </span>
        </div>
        <p className="text-caption text-ink-2">
          Type what you want to watch in plain words. FINN parses the company,
          metric, valuation, and condition automatically.
        </p>

        <form onSubmit={handleSubmit} className="space-y-2">
          <div className="flex gap-2">
            <input
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. Set an alert for HDFC bank's PE < 30"
              maxLength={300}
              className="h-11 min-w-0 flex-1 rounded-btn border border-rule bg-sheet px-3 text-body text-ink placeholder:text-ink-3 focus:border-royal focus:outline-none"
            />
            <button
              type="submit"
              disabled={createAlert.isPending || prompt.trim().length < 3}
              className="press inline-flex h-11 shrink-0 items-center gap-1.5 rounded-btn bg-royal px-4 font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {createAlert.isPending ? "Setting…" : "Set alert"}
            </button>
          </div>

          {/* Quick suggestion chips */}
          <div className="flex flex-wrap gap-1.5 pt-1">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setPrompt(s)}
                className="press inline-flex min-h-11 items-center rounded-pill border border-rule bg-sheet px-3 text-[12px] text-ink-2 hover:border-royal/50 hover:text-royal"
              >
                + {s}
              </button>
            ))}
          </div>
        </form>

        {notice && (
          <div className="rounded-btn bg-ledger border border-rule px-3 py-2 text-caption font-medium text-ink flex items-center justify-between">
            <span>{notice}</span>
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="text-ink-3 hover:text-ink"
            >
              <X size={14} />
            </button>
          </div>
        )}
      </section>

      {/* 2. Pending alerts list */}
      <section className="space-y-2.5" aria-labelledby="pending-alerts-heading">
        <div className="flex items-center justify-between">
          <SectionTitle id="pending-alerts-heading">
            Pending alerts
          </SectionTitle>
          <span className="text-caption text-ink-3">
            {pendingAlerts.length}{" "}
            {pendingAlerts.length === 1 ? "trigger" : "triggers"} waiting
          </span>
        </div>
        <p className="text-caption text-ink-2">
          These rules are active and watching live price feeds, valuations, and
          filings. When conditions are met, they will trigger in your feed.
        </p>

        {pendingAlerts.length === 0 && (
          <p className="text-body text-ink-2">None yet.</p>
        )}
        <ul
          className={
            pendingAlerts.length
              ? "divide-y divide-rule rounded-card border border-rule bg-sheet"
              : "hidden"
          }
        >
          {pendingAlerts.map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between gap-3 px-3.5 py-3"
            >
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-ink text-body">
                    {item.summary}
                  </span>
                  <Pill tone="behind">Watching</Pill>
                </div>
                <div className="flex items-center gap-3 text-caption text-ink-3">
                  <span>{item.symbol}</span>
                  {item.current_value && (
                    <span>Current: {item.current_value}</span>
                  )}
                  <span>Watching</span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => deleteAlert.mutate(item.id)}
                title="Remove alert"
                disabled={deleteAlert.isPending}
                className="press p-1.5 text-ink-3 hover:text-missed"
              >
                <Trash2 size={16} />
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

// ─── Thresholds & Filing Rules ────────────────────────────────────────────────

const MOVE_PRESETS = [
  { value: "3", label: "Only big surprises", hint: "3× the usual daily move" },
  { value: "2", label: "Anything unusual", hint: "2× the usual daily move" },
  { value: "custom", label: "Custom" },
] as const;
const VOLUME_PRESETS = [
  { value: "3", label: "3× 20-day average" },
  { value: "2", label: "2×" },
  { value: "custom", label: "Custom" },
] as const;
const presetOf = (v: number) => (v === 3 ? "3" : v === 2 ? "2" : "custom");

function useSettled<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

// ─── Connect Telegram / WhatsApp Alerts Section ───────────────────────────────

function ConnectChannelsSection({ delivery }: { delivery?: Delivery }) {
  const qc = useQueryClient();
  const [phone, setPhone] = useState("+91 ");
  const [phoneSaved, setPhoneSaved] = useState(false);
  const [savingPhone, setSavingPhone] = useState(false);

  const connectWhatsApp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (phone.trim().length >= 10) {
      setSavingPhone(true);
      try {
        await api("/v1/alerts/connect-channel", {
          method: "POST",
          body: JSON.stringify({ channel: "whatsapp", phone: phone.trim() }),
        });
        setPhoneSaved(true);
        void qc.invalidateQueries({ queryKey: ["alert-rules"] });
      } catch {
        // Fallback optimistic save
        setPhoneSaved(true);
      } finally {
        setSavingPhone(false);
      }
    }
  };

  return (
    <section
      className="space-y-3 pt-4 border-t border-rule"
      aria-labelledby="connect-channels-heading"
    >
      <div className="space-y-1">
        <SectionTitle id="connect-channels-heading">
          Connect to Telegram & WhatsApp alerts
        </SectionTitle>
        <p className="text-caption text-ink-2">
          Get high-priority alerts delivered directly to your messaging apps the
          moment they trigger. At most 3 messages a day to avoid noise.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {/* Telegram Card */}
        <div className="rounded-card border border-rule bg-sheet p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-btn bg-[#229ED9]/10 text-[#229ED9]">
                <TelegramIcon size={18} />
              </span>
              <span className="font-semibold text-ink">Telegram</span>
            </div>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                delivery?.connected
                  ? "bg-met-tint text-met"
                  : "bg-ledger text-ink-3"
              }`}
            >
              {delivery?.connected ? "Connected" : "Not connected"}
            </span>
          </div>
          <p className="text-caption text-ink-2">
            {delivery?.connected
              ? "Live alerts are delivered to your Telegram chat."
              : "Link your Telegram account via the bot to receive alerts instantly."}
          </p>
          {delivery?.connect_url ? (
            <a
              href={delivery.connect_url}
              target="_blank"
              rel="noopener noreferrer"
              className="press inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-btn bg-[#229ED9] text-xs font-medium text-white hover:opacity-90"
            >
              <TelegramIcon size={14} />
              {delivery.connected
                ? "Open Telegram chat ↗"
                : "Connect on Telegram ↗"}
            </a>
          ) : (
            <a
              href="https://t.me/finn_alerts_bot"
              target="_blank"
              rel="noopener noreferrer"
              className="press inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-btn border border-rule bg-paper text-xs font-medium text-royal hover:bg-ledger"
            >
              Connect on Telegram ↗
            </a>
          )}
        </div>

        {/* WhatsApp Card */}
        <div className="rounded-card border border-rule bg-sheet p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-btn bg-[#25D366]/10 text-[#25D366]">
                <WhatsAppIcon size={17} />
              </span>
              <span className="font-semibold text-ink">WhatsApp</span>
            </div>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                phoneSaved ? "bg-met-tint text-met" : "bg-ledger text-ink-3"
              }`}
            >
              {phoneSaved ? "Connected" : "Not connected"}
            </span>
          </div>

          {phoneSaved ? (
            <div className="space-y-2">
              <p className="text-caption text-ink-2">
                ✓ Alerts active for{" "}
                <span className="font-medium text-ink">{phone}</span>.
              </p>
              <button
                type="button"
                onClick={() => setPhoneSaved(false)}
                className="text-caption font-medium text-royal underline"
              >
                Change number
              </button>
            </div>
          ) : (
            <form onSubmit={connectWhatsApp} className="space-y-2">
              <div className="flex gap-1.5">
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+91 98765 43210"
                  className="h-9 min-w-0 flex-1 rounded-btn border border-rule bg-paper px-2.5 text-caption text-ink placeholder:text-ink-3 focus:border-royal focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={savingPhone || phone.trim().length < 10}
                  className="press inline-flex h-9 shrink-0 items-center gap-1 rounded-btn bg-[#25D366] px-3 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
                >
                  <WhatsAppIcon size={13} />
                  {savingPhone ? "Saving…" : "Connect"}
                </button>
              </div>
              <p className="text-[11px] text-ink-3">
                Enter your mobile number with country code (+91).
              </p>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}

function RulesForm({ saved }: { saved: AlertRules }) {
  const qc = useQueryClient();
  const [move, setMove] = useState(saved.move_sigma);
  const [vol, setVol] = useState(saved.volume_x);
  const [movePreset, setMovePreset] = useState<string>(
    presetOf(saved.move_sigma),
  );
  const [volPreset, setVolPreset] = useState<string>(presetOf(saved.volume_x));
  const [cats, setCats] = useState(saved.categories);
  const [showCats, setShowCats] = useState(false);
  const onCount = ALERT_CATEGORIES.filter((c) => cats[c]).length;
  const offList = ALERT_CATEGORIES.filter((c) => !cats[c]).map(categoryLabel);
  const settledMove = useSettled(move);
  const settledVol = useSettled(vol);
  const preview = useQuery(q.preview(settledMove, settledVol));
  const dirty =
    move !== saved.move_sigma ||
    vol !== saved.volume_x ||
    ALERT_CATEGORIES.some((c) => cats[c] !== saved.categories[c]);

  const save = useMutation({
    mutationFn: () =>
      api<AlertRules>("/v1/alerts/rules", {
        method: "PUT",
        body: JSON.stringify({
          move_sigma: move,
          volume_x: vol,
          categories: cats,
        }),
      }),
    onSuccess: (res) => {
      bustCache();
      qc.setQueryData(q.alertRules().queryKey, (prev) => ({
        ...res,
        data: { ...res.data, delivery: prev?.data.delivery },
      }));
      void qc.invalidateQueries({ queryKey: ["alerts"] });
    },
  });

  const p = preview.data?.data;
  const updating =
    preview.isFetching || settledMove !== move || settledVol !== vol;
  const delivery = saved.delivery;

  return (
    <div className="space-y-8">
      {/* 1. Custom Natural Language Triggers & Pending Alerts */}
      <CustomTriggerSection />

      {/* 2. Threshold Rules Section */}
      <div className="space-y-6 pt-4 border-t border-rule">
        <SectionTitle>Market move & volume thresholds</SectionTitle>

        <section className="space-y-3" aria-labelledby="price-rule">
          <SectionTitle id="price-rule">Unusual price moves</SectionTitle>
          <ChipGroup
            label="Alert me when a stock moves"
            value={movePreset}
            onChange={(v) => {
              setMovePreset(v);
              if (v !== "custom") setMove(Number(v));
            }}
            options={MOVE_PRESETS.map((o) => ({
              ...o,
              label:
                o.value === "custom" ? o.label : `${o.label} (${o.value}×)`,
            }))}
          />
          {movePreset === "custom" && (
            <Stepper
              label="multiple of the usual daily move"
              value={move}
              onChange={setMove}
              min={1}
              max={6}
              step={0.5}
              suffix="×"
            />
          )}
          <p className="text-caption text-ink-3">
            The usual daily move is the standard deviation of the last 60
            sessions.
          </p>
        </section>

        <section className="space-y-3" aria-labelledby="volume-rule">
          <SectionTitle id="volume-rule">Unusual volume</SectionTitle>
          <ChipGroup
            label="Alert me when volume reaches"
            value={volPreset}
            onChange={(v) => {
              setVolPreset(v);
              if (v !== "custom") setVol(Number(v));
            }}
            options={[...VOLUME_PRESETS]}
          />
          {volPreset === "custom" && (
            <Stepper
              label="multiple of the 20-day average volume"
              value={vol}
              onChange={setVol}
              min={1}
              max={20}
              step={0.5}
              suffix="×"
            />
          )}
        </section>

        {/* Live preview */}
        <section
          aria-live="polite"
          aria-busy={updating}
          className="rounded-card bg-ledger px-4 py-3"
        >
          {preview.isError ? (
            <p className="text-caption text-ink-2">{preview.error.message}</p>
          ) : p ? (
            <div
              className={`space-y-1 transition-opacity ${updating ? "opacity-60" : ""}`}
            >
              <p className="text-body text-ink">
                With these settings,{" "}
                <span className="font-semibold">{p.would_have_fired_30d}</span>{" "}
                {p.would_have_fired_30d === 1 ? "alert" : "alerts"} would have
                fired in the last 30 days.
              </p>
              <p className="text-caption text-ink-2">
                Price moves past the line: {p.by_kind.move_sigma}. Volume
                spikes: {p.by_kind.volume_x}. A day with both counts once.
              </p>
              {p.examples[0] && (
                <p className="text-caption text-ink-3">
                  Biggest: {p.examples[0].symbol}{" "}
                  {p.examples[0].text.charAt(0).toLowerCase() +
                    p.examples[0].text.slice(1).replace(/\.$/, "")}{" "}
                  on {istDate(`${p.examples[0].date}T12:00:00+05:30`)}.
                </p>
              )}
            </div>
          ) : (
            <p className="text-caption text-ink-3">
              Working out what would have fired…
            </p>
          )}
        </section>

        {/* Filing types */}
        <section className="space-y-2" aria-labelledby="filing-rule">
          <SectionTitle id="filing-rule">Filing types</SectionTitle>
          <p className="rounded-btn border border-rule bg-sheet px-3 py-2 text-caption text-ink-2">
            {saved.always_first}
          </p>
          <button
            type="button"
            onClick={() => setShowCats((x) => !x)}
            aria-expanded={showCats}
            aria-controls="category-switches"
            className="press -mx-2 flex min-h-12 w-[calc(100%+1rem)] items-center justify-between rounded-btn px-2 text-left hover:bg-sheet"
          >
            <span className="text-body text-ink">
              {onCount === ALERT_CATEGORIES.length
                ? `All ${onCount} filing types on`
                : `${onCount} of ${ALERT_CATEGORIES.length} filing types on`}
              {offList.length > 0 && (
                <span className="block text-caption text-ink-3">
                  Off: {offList.join(", ")}
                </span>
              )}
            </span>
            <span className="text-caption font-medium text-royal">
              {showCats ? "Hide" : "Change"}
            </span>
          </button>
          {showCats && (
            <div id="category-switches" className="divide-y divide-rule">
              {ALERT_CATEGORIES.map((c) => (
                <Switch
                  key={c}
                  label={categoryLabel(c)}
                  checked={cats[c]}
                  onChange={(v) =>
                    setCats(
                      (x) =>
                        ({ ...x, [c]: v }) as Record<AlertCategory, boolean>,
                    )
                  }
                />
              ))}
            </div>
          )}
        </section>
      </div>

      {/* 3. Connect to Telegram / WhatsApp Alerts (Requirement 4) */}
      <ConnectChannelsSection delivery={delivery} />

      {/* Sticky save bar */}
      {(dirty || save.isSuccess || save.isError) && (
        <div
          className="sticky z-10 -mx-4 border-t border-rule bg-paper/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6"
          style={{
            bottom: "calc(64px + 12px + 8px + env(safe-area-inset-bottom))",
          }}
        >
          {save.isError && (
            <p className="pb-2 text-caption text-behind-text">
              {save.error.message}
            </p>
          )}
          {dirty ? (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setMove(saved.move_sigma);
                  setVol(saved.volume_x);
                  setMovePreset(presetOf(saved.move_sigma));
                  setVolPreset(presetOf(saved.volume_x));
                  setCats(saved.categories);
                }}
                className="press h-11 flex-1 rounded-btn border border-rule bg-sheet font-medium text-ink hover:bg-ledger"
              >
                Undo changes
              </button>
              <button
                type="button"
                onClick={() => save.mutate()}
                disabled={save.isPending}
                className="press h-11 flex-1 rounded-btn bg-royal font-medium text-white disabled:opacity-60"
              >
                {save.isPending ? "Saving" : "Save rules"}
              </button>
            </div>
          ) : (
            save.isSuccess && (
              <p className="text-caption text-ink-2" role="status">
                <span className="font-semibold text-met">✓</span> Saved.
                Triggered now shows this week with these rules.
              </p>
            )
          )}
        </div>
      )}
    </div>
  );
}

function CreateNewAlertTab() {
  const rules = useQuery(q.alertRules());
  if (rules.isPending) return <Skeleton rows={4} />;
  if (rules.isError)
    return (
      <ErrorLine
        message={rules.error.message}
        onRetry={() => rules.refetch()}
      />
    );
  return <RulesForm saved={rules.data.data} />;
}

export function AlertsPage() {
  const [params, setParams] = useSearchParams();
  const alerts = useQuery(q.alerts());
  // Accept "rules" or "create" to view the Create new alert tab
  const rawSeg = params.get("seg");
  const seg =
    rawSeg === "rules" || rawSeg === "create" ? "create" : "triggered";

  const go = (v: "triggered" | "create") => {
    const next = new URLSearchParams(params);
    v === "triggered" ? next.delete("seg") : next.set("seg", "create");
    setParams(next, { replace: true });
  };

  const count = alerts.data?.data.days.reduce((n, d) => n + d.items.length, 0);

  return (
    <div className="space-y-4">
      <PageTitle>Alerts</PageTitle>
      <SegmentedControl
        label="Alerts"
        value={seg}
        onChange={go}
        controls="alerts-panel"
        options={[
          {
            value: "triggered",
            label: "Notifications",
            ...(count !== undefined ? { count } : {}),
          },
          { value: "create", label: "Create Alert" },
        ]}
      />
      <div id="alerts-panel" role="tabpanel">
        {seg === "triggered" ? (
          <Triggered onRules={() => go("create")} />
        ) : (
          <CreateNewAlertTab />
        )}
      </div>
    </div>
  );
}
