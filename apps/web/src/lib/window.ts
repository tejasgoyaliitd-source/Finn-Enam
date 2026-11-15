import { istDate, istWeekday } from "./format";

/**
 * The Brief's time window. It lives in the URL (?w=24h, ?w=custom&from=…&to=…) so a link or the
 * back button brings back the same view; "since last visit" is the default and needs no param.
 */
export type WindowKind = "visit" | "24h" | "7d" | "results" | "custom";

export interface BriefWindow {
  kind: WindowKind;
  /** ISO timestamps; for "results" the API works out the start. */
  since: string | null;
  until: string | null;
}

export const WINDOW_LABEL: Record<WindowKind, string> = {
  results: "Since last results",
  visit: "Since last visit",
  "24h": "Last 24 hours",
  "7d": "Last 7 days",
  custom: "Custom range",
};

const LAST_VISIT = "finn-last-visit";
const PREV_VISIT = "finn-prev-visit";

const safe = <T,>(fn: () => T, fallback: T): T => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

/** Rounded down to the minute so the cache key holds steady within a session. */
const floorMinute = (ms: number) => new Date(Math.floor(ms / 60_000) * 60_000).toISOString();
const floorHour = (ms: number) => new Date(Math.floor(ms / 3_600_000) * 3_600_000).toISOString();

/**
 * The previous visit, fixed for this browser session: read once, then today's visit is recorded
 * so the next session starts from here. Reloads in the same session keep the same window.
 */
export const previousVisit: string | null = safe(() => {
  const kept = sessionStorage.getItem(PREV_VISIT);
  if (kept !== null) return kept || null;
  const last = localStorage.getItem(LAST_VISIT);
  sessionStorage.setItem(PREV_VISIT, last ?? "");
  localStorage.setItem(LAST_VISIT, floorMinute(Date.now()));
  return last;
}, null);

/** The Feed opens on the latest results season; other windows are chosen from the picker. */
export function windowFromParams(p: URLSearchParams): BriefWindow {
  const w = p.get("w") as WindowKind | null;
  const now = Date.now();
  switch (w) {
    case "24h":
      return { kind: "24h", since: floorHour(now - 864e5), until: null };
    case "7d":
      return { kind: "7d", since: floorHour(now - 7 * 864e5), until: null };
    case "results":
    case null:
      return { kind: "results", since: null, until: null };
    case "custom": {
      const from = p.get("from");
      const to = p.get("to");
      if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) {
        return {
          kind: "custom",
          since: new Date(`${from}T00:00:00+05:30`).toISOString(),
          until: to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? new Date(new Date(`${to}T00:00:00+05:30`).getTime() + 864e5).toISOString() : null,
        };
      }
      break;
    }
  }
  if (w === "visit") {
    // Since last visit; a first visit shows the last 7 days.
    return { kind: "visit", since: previousVisit ?? floorHour(now - 7 * 864e5), until: null };
  }
  // The default: everything since the latest results season began (the API works out the date).
  return { kind: "results", since: null, until: null };
}

/** The window as query params for /v1/brief. */
export function windowQuery(w: BriefWindow): string {
  const q = new URLSearchParams();
  if (w.kind === "results") q.set("window", "results");
  if (w.since) q.set("since", w.since);
  if (w.until) q.set("until", w.until);
  return q.toString();
}

/** Copies the window params from one search string onto another (for list pages and sheets). */
export function carryWindow(from: URLSearchParams, into = new URLSearchParams()): URLSearchParams {
  for (const k of ["w", "from", "to"]) {
    const v = from.get(k);
    if (v) into.set(k, v);
  }
  return into;
}

const istTime = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false });

/** "Thursday" within the last week, else "8 Nov". */
export function sinceWord(iso: string): string {
  return Date.now() - new Date(iso).getTime() < 6 * 864e5 ? new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "long" }) : istDate(iso);
}

/** The hero's subline: "Since your last visit, Thu 18:40." */
export function windowSubline(w: BriefWindow, usedFrom: string, usedTo: string): string {
  switch (w.kind) {
    case "visit":
      return previousVisit ? `Since your last visit, ${istWeekday(usedFrom)} ${istTime(usedFrom)}.` : "Your first visit: the last 7 days.";
    case "24h":
      return "In the last 24 hours.";
    case "7d":
      return "In the last 7 days.";
    case "results":
      return `Since results season began, ${istWeekday(usedFrom)} ${istDate(usedFrom)}.`;
    case "custom":
      return `From ${istDate(usedFrom)} to ${istDate(usedTo)}.`;
  }
}

/** "since Thursday", "in the last 24 hours": the tail of "Nothing needs you …". */
export function windowPhrase(w: BriefWindow, usedFrom: string): string {
  switch (w.kind) {
    case "24h":
      return "in the last 24 hours";
    case "7d":
      return "in the last 7 days";
    case "custom":
      return "in this range";
    default:
      return `since ${sinceWord(usedFrom)}`;
  }
}

const shortDay = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short" })} ${istDate(d)}`;
};

/** The window button's own words, so the page needs no grey line explaining it: "Since Mon 9 Nov". */
export function windowButtonLabel(w: BriefWindow, usedFrom: string, usedTo: string): string {
  switch (w.kind) {
    case "visit":
      return previousVisit ? `Since ${shortDay(usedFrom)}` : "Last 7 days";
    case "24h":
      return "Last 24 hours";
    case "7d":
      return "Last 7 days";
    case "results":
      return `Since results began, ${istDate(usedFrom)}`;
    case "custom":
      return `${istDate(usedFrom)} to ${istDate(usedTo)}`;
  }
}
