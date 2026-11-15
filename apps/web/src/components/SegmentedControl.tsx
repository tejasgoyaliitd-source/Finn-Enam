import { useRef, type KeyboardEvent } from "react";

/**
 * Splits a page into views so only one list shows at a time. The chosen view is a dark pill;
 * counts sit in the labels. 44 px tall; arrow keys move between segments (a tablist).
 */
export function SegmentedControl<T extends string>({
  label,
  value,
  onChange,
  options,
  controls,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; count?: number }[];
  /** id of the panel the segments switch. */
  controls?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (i + step + options.length) % options.length;
    onChange(options[next]!.value);
    refs.current[next]?.focus();
  };
  return (
    <div role="tablist" aria-label={label} className="flex h-11 gap-1 rounded-btn border border-rule bg-sheet p-1">
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            aria-selected={on}
            aria-controls={controls}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKey(e, i)}
            className={`press flex-auto whitespace-nowrap rounded-[6px] px-1.5 text-caption font-medium transition-colors ${on ? "bg-ink text-white" : "text-ink-2 hover:bg-paper hover:text-ink"}`}
          >
            {o.label}
            {o.count !== undefined && <span className={`ml-1 ${on ? "text-white/80" : "text-ink-3"}`}>{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
