import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

/**
 * Chips that pick one value (a radio group): presets, filters. 44 px targets; arrow keys move
 * between chips; the chosen chip is filled, never signalled by colour alone (it also gets a ✓).
 */
export function ChipGroup<T extends string>({
  label,
  value,
  onChange,
  options,
  hideLabel = false,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; hint?: string }[];
  hideLabel?: boolean;
}) {
  const id = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const n = (i + step + options.length) % options.length;
    onChange(options[n]!.value);
    refs.current[n]?.focus();
  };
  return (
    <div className="space-y-2">
      <p id={id} className={hideLabel ? "sr-only" : "text-caption font-medium text-ink-2"}>
        {label}
      </p>
      <div role="radiogroup" aria-labelledby={id} className="flex flex-wrap gap-2">
        {options.map((o, i) => {
          const on = o.value === value;
          return (
            <button
              key={o.value}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              onClick={() => onChange(o.value)}
              onKeyDown={(e) => onKey(e, i)}
              title={o.hint}
              className={`press inline-flex min-h-11 items-center gap-1.5 rounded-pill border px-3.5 text-caption font-medium ${
                on ? "border-royal bg-royal text-white" : "border-rule bg-sheet text-ink hover:bg-ledger"
              }`}
            >
              {on && <span aria-hidden="true">✓</span>}
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** An on/off switch with its label; the whole row is the target. */
export function Switch({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="press -mx-2 flex min-h-12 w-[calc(100%+1rem)] items-center justify-between gap-4 rounded-btn px-2 text-left hover:bg-sheet"
    >
      <span className="min-w-0">
        <span className="block text-body text-ink">{label}</span>
        {hint && <span className="block text-caption text-ink-3">{hint}</span>}
      </span>
      <span aria-hidden="true" className={`relative h-6 w-10 shrink-0 rounded-pill transition-colors ${checked ? "bg-royal" : "bg-rule"}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-pill bg-white shadow-[0_1px_2px_rgb(23_33_46/0.2)] transition-[left] ${checked ? "left-[18px]" : "left-0.5"}`} />
      </span>
    </button>
  );
}

/** A number with − / + steps and a typed value, clamped to its range. */
export function Stepper({ label, value, onChange, min, max, step, suffix }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step: number; suffix: string }) {
  const id = useId();
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v / step) * step));
  // Typed text is kept as typed ("2.") and committed on blur or Enter, then shown clamped.
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const v = Number(text);
    if (text.trim() !== "" && Number.isFinite(v)) onChange(clamp(v));
    else setText(String(value));
  };
  const btn = "press grid h-11 w-11 place-items-center rounded-btn border border-rule bg-sheet text-body font-medium text-ink hover:bg-ledger disabled:opacity-40";
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <button type="button" aria-label={`Lower ${label}`} disabled={value <= min} onClick={() => onChange(clamp(value - step))} className={btn}>
        −
      </button>
      <span className="relative">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && commit()}
          className="h-11 w-20 rounded-btn border border-rule bg-sheet pr-6 text-center text-num font-medium text-ink focus:border-royal"
        />
        <span aria-hidden="true" className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-caption text-ink-3">
          {suffix}
        </span>
      </span>
      <button type="button" aria-label={`Raise ${label}`} disabled={value >= max} onClick={() => onChange(clamp(value + step))} className={btn}>
        +
      </button>
    </div>
  );
}
