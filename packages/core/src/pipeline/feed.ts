import type { FilingTier, IstDateTime } from "@finn/shared";

export interface FeedItem {
  filing_id: number;
  event_id: number;
  symbol: string;
  tier: FilingTier;
  score: number;
  headline: string;
  reasons: string[];
  filed_at: IstDateTime;
}

export interface FeedCard {
  event_id: number;
  symbol: string;
  /** Highest tier among the event's filings. */
  tier: FilingTier;
  primary: FeedItem;
  /** Secondary filings folded under the primary (deck, press release, newspaper ad...). */
  related: FeedItem[];
}

export interface Feed {
  act: FeedCard[];
  read: FeedCard[];
  /** Never deleted: folded behind a count, expandable. */
  routine: { count: number; cards: FeedCard[] };
}

const RANK: Record<FilingTier, number> = { act: 3, read: 2, routine: 1 };

/**
 * One card per event. The card's tier is the highest tier among its filings, so a routine
 * newspaper ad folded into a results event never drags the results down, and a red flag
 * inside a group is never hidden. Duplicates have no analysis and never reach here.
 */
export function foldFeed(items: FeedItem[], primaryOf: (eventId: number) => number): Feed {
  const byEvent = new Map<number, FeedItem[]>();
  for (const i of items) byEvent.set(i.event_id, [...(byEvent.get(i.event_id) ?? []), i]);

  const cards: FeedCard[] = [...byEvent.entries()].map(([event_id, members]) => {
    const pid = primaryOf(event_id);
    const primary = members.find((m) => m.filing_id === pid) ?? members[0]!;
    const tier = members.reduce<FilingTier>((t, m) => (RANK[m.tier] > RANK[t] ? m.tier : t), "routine");
    return { event_id, symbol: primary.symbol, tier, primary, related: members.filter((m) => m !== primary) };
  });

  const byScore = (a: FeedCard, b: FeedCard) =>
    Math.max(b.primary.score, ...b.related.map((r) => r.score)) - Math.max(a.primary.score, ...a.related.map((r) => r.score)) ||
    b.primary.filed_at.localeCompare(a.primary.filed_at);
  const routine = cards.filter((c) => c.tier === "routine");
  return {
    act: cards.filter((c) => c.tier === "act").sort(byScore),
    read: cards.filter((c) => c.tier === "read").sort(byScore),
    routine: { count: routine.reduce((n, c) => n + 1 + c.related.length, 0), cards: routine.sort(byScore) },
  };
}
