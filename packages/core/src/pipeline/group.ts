import type { FilingCategory, IstDateTime } from "@finn/shared";
import { istToEpochMs } from "../time";
import { extractRole } from "./headline";

/**
 * Event grouping: filings about the same corporate action become one event with one
 * primary filing; the rest fold under it.
 *
 *   results family (36 h): results > press release > investor presentation > newspaper ad
 *     e.g. results table at 16:42, deck at 17:05, press release at 17:10, newspaper ad next morning
 *   management family (24 h, same role): resignation > appointment
 *     e.g. "CFO resigned" and "new CFO appointed" on the same day
 * Everything else is its own single-filing event.
 */

export interface Family {
  kind: FilingCategory;
  rank: number;
  windowMs: number;
  /** Extra key that must match, e.g. the role for management changes. */
  key: string;
}

const H = 60 * 60 * 1000;
const RESULTS_TALK = /\bresults?\b|financial|\bquarter|\bq[1-4]\b|performance|earnings/i;

export function familyOf(f: { category: FilingCategory; sub_kind: string | null; subject: string }): Family | null {
  const results = (rank: number): Family => ({ kind: "results", rank, windowMs: 36 * H, key: "" });
  switch (f.sub_kind) {
    case "results": return results(4);
    case "press_release": return RESULTS_TALK.test(f.subject) ? results(3) : null;
    case "investor_presentation": return results(2);
    case "newspaper_ad": return RESULTS_TALK.test(f.subject) ? results(1) : null;
    case "resignation":
    case "appointment": {
      const role = extractRole(f.subject);
      return role ? { kind: "management_change", rank: f.sub_kind === "resignation" ? 2 : 1, windowMs: 24 * H, key: role } : null;
    }
    default: return null;
  }
}

export interface GroupMember {
  /** Database id (filings are inserted before grouping). */
  id: number;
  symbol: string;
  filed_at: IstDateTime;
  category: FilingCategory;
  sub_kind: string | null;
  subject: string;
}

export interface OpenEvent {
  id: number | null;
  /** Batch-local handle until the event is created. */
  handle: string;
  symbol: string;
  kind: FilingCategory;
  family: Family | null;
  primary: GroupMember;
  members: GroupMember[];
  /** Existing event whose primary changed and must be updated. */
  promoted: boolean;
}

/**
 * Assigns each new filing to an event: joins a matching open event (existing or created
 * earlier in this batch) or opens a new one. Pure; the caller persists the result.
 */
export function groupFilings(newFilings: GroupMember[], existing: OpenEvent[]): OpenEvent[] {
  const events = [...existing];
  let n = 0;
  for (const f of [...newFilings].sort((a, b) => a.filed_at.localeCompare(b.filed_at))) {
    const fam = familyOf(f);
    const t = istToEpochMs(f.filed_at);
    const match = fam
      ? events.find(
          (e) =>
            e.symbol === f.symbol &&
            e.family?.kind === fam.kind &&
            e.family.key === fam.key &&
            Math.abs(t - istToEpochMs(e.primary.filed_at)) <= fam.windowMs,
        )
      : undefined;

    if (match) {
      match.members.push(f);
      if (fam!.rank > match.family!.rank) {
        match.primary = f;
        match.family = fam;
        match.promoted = match.id !== null;
      }
    } else {
      events.push({ id: null, handle: `new-${n++}`, symbol: f.symbol, kind: fam?.kind ?? f.category, family: fam, primary: f, members: [f], promoted: false });
    }
  }
  return events;
}
