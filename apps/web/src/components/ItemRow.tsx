import { useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { cleanReasons, istDate, shortName, trueMinus, weight } from "../lib/format";
import { q, type BriefItem } from "../lib/queries";
import { cardClass, Pill } from "../pages/parts";
import { RecordStrip } from "./RecordStrip";

/** The sheet for a filing opens through the URL, so back closes it and links can share it. */
export function useSheetHref() {
  const [params] = useSearchParams();
  return (id: number) => {
    const next = new URLSearchParams(params);
    next.set("sheet", `item:${id}`);
    return `?${next}`;
  };
}

/**
 * One changed thing, as a card: company and its share of the book, the headline in bold, then the
 * one reason it ranks here. An always-flagged item says why in a red pill. The whole card opens the sheet.
 */
export function ItemRow({ item, showDate = false }: { item: BriefItem; showDate?: boolean }) {
  const qc = useQueryClient();
  const href = useSheetHref();
  const flag = item.reasons.find((r) => r.startsWith("Always flagged"))?.replace(/^Always flagged:\s*/, "");
  // Neither the headline nor the weight is worth repeating as a reason.
  const reasons = cleanReasons(item.reasons, item.headline).filter((r) => !r.startsWith("Always flagged"));
  const prefetch = () => void qc.prefetchQuery(q.item(item.filing_id));
  return (
    <Link
      to={href(item.filing_id)}
      onPointerEnter={prefetch}
      onTouchStart={prefetch}
      onFocus={prefetch}
      className={`${cardClass} press block space-y-1 px-4 py-3.5 transition-[border-color,transform] hover:-translate-y-px hover:border-ink-3/40`}
    >
      <span className="flex items-baseline justify-between gap-3">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-caption font-medium text-ink-2">{shortName(item.name)}</span>
          <RecordStrip record={item.record} />
        </span>
        {item.weight_pct !== null && <span className="shrink-0 text-caption text-ink-3">{weight(item.weight_pct)} of book</span>}
      </span>
      <span className="block text-[17px] font-semibold leading-6 text-ink">{trueMinus(item.headline)}</span>
      {(reasons.length > 0 || showDate) && (
        <span className="line-clamp-2 block text-caption text-ink-2">
          {trueMinus(reasons.join(". "))}
          {reasons.length ? ". " : ""}
          {showDate ? `${istDate(item.filed_at)}.` : ""}
        </span>
      )}
      {flag && (
        <span className="block pt-1">
          <Pill tone="missed">{flag.charAt(0).toUpperCase() + flag.slice(1)}</Pill>
        </span>
      )}
    </Link>
  );
}
