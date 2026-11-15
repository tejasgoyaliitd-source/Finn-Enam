import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { useQuery, useQueryClient, type UseQueryOptions } from "@tanstack/react-query";
import { Outlet, useLocation, useMatch, useNavigate, useSearchParams } from "react-router";
import type { Envelope } from "../lib/api";
import { q } from "../lib/queries";
import { windowFromParams } from "../lib/window";
import { ItemSheet } from "../components/ItemSheet";
import { LIST_KINDS } from "../pages/TabPages";
import { readLocal, writeLocal } from "../lib/query";
import { FloatingNav } from "./FloatingNav";
import { ReviewerGuide, SettingsSheet } from "./Sheets";
import { TABS, tabById, tabFor, type TabId } from "./tabs";
import { TopBar } from "./TopBar";

const online = {
  subscribe: (cb: () => void) => {
    window.addEventListener("online", cb);
    window.addEventListener("offline", cb);
    return () => {
      window.removeEventListener("online", cb);
      window.removeEventListener("offline", cb);
    };
  },
  get: () => navigator.onLine,
};

const LAST_TAB = "finn-last-tab";
const ALERTS_SEEN = "finn-alerts-seen";

export function Shell() {
  const location = useLocation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const isOnline = useSyncExternalStore(online.subscribe, online.get);
  const company = useMatch("/c/:symbol/*");
  const list = useMatch("/list/:kind");

  // The tab you came from stays active on company and list pages; Back returns to it.
  const tab = tabFor(location.pathname);
  const [lastTab, setLastTab] = useState<TabId>(() => (readLocal(LAST_TAB) as TabId | null) ?? "brief");
  useEffect(() => {
    if (tab && tab !== lastTab) {
      setLastTab(tab);
      writeLocal(LAST_TAB, tab);
    }
  }, [tab, lastTab]);
  const activeTab: TabId = tab ?? lastTab;

  // Each tab keeps its own scroll position.
  const scroll = useRef(new Map<string, number>());
  const prevKey = useRef(location.pathname);
  useLayoutEffect(() => {
    scroll.current.set(prevKey.current, window.scrollY);
    window.scrollTo(0, scroll.current.get(location.pathname) ?? 0);
    prevKey.current = location.pathname;
  }, [location.pathname]);

  // Prefetch the two tabs reviewers open first.
  useEffect(() => {
    void qc.prefetchQuery(q.brief());
    void qc.prefetchQuery(q.holdings());
  }, [qc]);

  // Data behind the top bar's as-of line: the page's own main query.
  const symbol = company?.params.symbol?.toUpperCase();
  const pageQuery = (symbol ? q.company(symbol) : activeTab === "brief" && !list ? q.brief(windowFromParams(params)) : activeTab === "portfolio" ? q.holdings() : activeTab === "alerts" ? q.alerts() : q.health()) as unknown as UseQueryOptions<Envelope<unknown>>;
  const page = useQuery(pageQuery);
  const companyName = symbol ? ((page.data?.data as { header?: { name?: string } } | undefined)?.header?.name ?? symbol) : null;

  // Badges: Brief = items that need you; Alerts = alerts since your last visit to Alerts.
  const brief = useQuery(q.brief());
  const alerts = useQuery(q.alerts());
  const [alertsSeen, setAlertsSeen] = useState(() => readLocal(ALERTS_SEEN) ?? "");
  useEffect(() => {
    if (tab === "alerts") {
      const today = new Date().toISOString().slice(0, 10);
      setAlertsSeen(today);
      writeLocal(ALERTS_SEEN, today);
    }
  }, [tab]);
  const newAlerts = (alerts.data?.data.days ?? []).filter((d) => d.date > alertsSeen).reduce((n, d) => n + d.items.length, 0);

  const health = useQuery(q.health());
  // Paused only when neither exchange is delivering: BSE is the designed fallback when NSE blocks us.
  const exchanges = (health.data?.data.sources ?? []).filter((s) => s.source === "nse" || s.source === "bse");
  const exchangeDegraded = exchanges.length > 0 && exchanges.every((s) => s.degraded);
  const isStale = (page.data?.stale ?? false) || exchangeDegraded;
  const staleReason =
    page.data?.stale_reason ??
    (exchangeDegraded ? "Exchange feed paused; retrying" : null);

  const sheet = params.get("sheet");
  // Item sheets open from any tab: ?sheet=item:240.
  const itemMatch = /^item:(\d+)$/.exec(sheet ?? "");
  const itemId = itemMatch ? Number(itemMatch[1]) : null;
  const openSheet = (name: string) => {
    const next = new URLSearchParams(params);
    next.set("sheet", name);
    setParams(next);
  };
  const closeSheet = useCallback(() => {
    const next = new URLSearchParams(params);
    next.delete("sheet");
    setParams(next, { replace: true });
  }, [params, setParams]);

  // The document title follows the page, for tab switchers and screen readers.
  const title = companyName ?? (list ? (LIST_KINDS[list.params.kind ?? ""]?.title ?? "See all") : tab ? tabById(tab).label : "FINN");
  useEffect(() => {
    document.title = title === "FINN" ? "FINN" : `${title} · FINN`;
  }, [title]);
  const back = company || list ? { label: tabById(lastTab).label, onBack: () => navigate(tabById(lastTab).path) } : undefined;

  return (
    <div className="min-h-dvh">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-btn focus:bg-sheet focus:px-4 focus:py-2 focus:text-royal">
        Skip to content
      </a>
      <TopBar
        back={back}
        onGuide={() => openSheet("guide")}
        onSettings={() => openSheet("settings")}
        freshness={{
          asOf: page.data?.as_of ?? null,
          stale: isStale,
          staleReason,
          offline: !isOnline,
          loadedAt: page.dataUpdatedAt || null,
          loading: page.isPending,
          error: page.error ? page.error.message : null,
        }}
      />
      <main
        id="main"
        className="mx-auto w-full max-w-[640px] px-4 pt-2 sm:px-6"
        style={{ paddingBottom: "calc(64px + 32px + env(safe-area-inset-bottom))" }}
      >
        <Outlet />
      </main>
      <FloatingNav active={activeTab} badges={{ brief: brief.data?.data.counts.act ?? 0, alerts: newAlerts }} />
      {sheet === "guide" && <ReviewerGuide onClose={closeSheet} />}
      {sheet === "settings" && <SettingsSheet onClose={closeSheet} />}
      {itemId !== null && <ItemSheet key={itemId} id={itemId} onClose={closeSheet} />}
    </div>
  );
}

export { TABS };
