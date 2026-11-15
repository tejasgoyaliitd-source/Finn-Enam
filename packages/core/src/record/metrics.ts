import type { GuidanceUnit, MetricKind } from "@finn/shared";

/**
 * Canonical metric keys. The key is what links a statement to the same target in later calls
 * and to an actual figure. Only the keys in MEASURABLE can ever be Met or Missed.
 */
export const MEASURABLE = new Set(["revenue", "revenue_growth", "ebitda", "ebitda_margin", "ebitda_growth", "pat", "pat_growth", "pat_margin"]);

const LABEL: Record<string, string> = {
  revenue: "revenue",
  revenue_growth: "revenue growth",
  revenue_growth_cc: "constant-currency revenue growth",
  ebitda: "EBITDA",
  ebitda_margin: "EBITDA margin",
  ebitda_growth: "EBITDA growth",
  pat: "PAT",
  pat_growth: "PAT growth",
  pat_margin: "PAT margin",
  capex: "capex",
};

export const metricName = (key: string, fallback?: string) => LABEL[key] ?? fallback ?? key.replace(/^other:/, "").replaceAll("_", " ");

/** Maps management's wording to a canonical key. Pure; deterministic. */
export function canonicalMetric(label: string, kind: MetricKind, unit: GuidanceUnit | null): string {
  const s = label.toLowerCase();
  const growth = kind === "growth" || /\bgrowth\b|\bgrow\b|\bincrease\b/.test(s);
  const margin = kind === "margin" || /\bmargin\b|\bopm\b/.test(s);
  const revenue = /\brevenue|\bsales\b|top ?line|\bturnover\b/.test(s);
  const ebitda = /\bebitda\b|\boperating profit\b|\bopm\b|\boperating margin\b/.test(s);
  const pat = /\bpat\b|\bnet profit\b|\bprofit after tax\b|\bbottom ?line\b|\bearnings\b/.test(s);

  if (/\bcapex\b|capital expenditure/.test(s)) return "capex";
  if (ebitda && margin) return "ebitda_margin";
  if (pat && margin) return "pat_margin";
  if (revenue && growth) return /constant currency|\bcc\b|\busd\b|dollar/.test(s) ? "revenue_growth_cc" : "revenue_growth";
  if (ebitda && growth) return "ebitda_growth";
  if (pat && growth) return "pat_growth";
  if (revenue && (unit === "inr_cr" || kind === "absolute")) return "revenue";
  if (ebitda && (unit === "inr_cr" || kind === "absolute")) return "ebitda";
  if (pat && (unit === "inr_cr" || kind === "absolute")) return "pat";
  if (/^ebitda$/.test(s.trim()) && unit === "pct") return "ebitda_margin";
  return `other:${s.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "unnamed"}`;
}

/** Why a key can't be checked against FINN's data. */
export function unmeasurableReason(key: string, label: string): string {
  if (key === "revenue_growth_cc") return "Constant-currency growth target; FINN has rupee figures only";
  if (key === "capex") return "No capex figure in FINN's data yet";
  return `No reported figure for "${label}" in FINN's data`;
}

/** Higher is better for every measurable key today. */
export const higherIsBetter = (_key: string) => true;

/**
 * Tolerance before a shortfall counts as Missed:
 *   margins: 0.5 percentage points
 *   growth, amounts and anything else: 2% of the threshold (relative)
 */
export function tolerance(key: string, threshold: number): { value: number; text: string } {
  if (key.endsWith("_margin")) return { value: 0.5, text: "0.5 pp" };
  return { value: Math.abs(threshold) * 0.02, text: "2%" };
}
