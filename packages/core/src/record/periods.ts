/** Indian fiscal periods: Q2FY27, H1FY27, 9MFY27, FY27. FY27 = Apr 2026 – Mar 2027. */

const RE = /^(Q[1-4]|H[12]|9M)?FY(\d{2})$/;

/** Q2FY27 → a number that orders quarters: 27·4 + 2. */
export function quarterOrdinal(q: string): number {
  const m = /^Q([1-4])FY(\d{2})$/.exec(q);
  if (!m) throw new Error(`not a quarter: ${q}`);
  return Number(m[2]) * 4 + Number(m[1]);
}

export function quarterFromOrdinal(n: number): string {
  const fy = Math.floor((n - 1) / 4);
  return `Q${n - fy * 4}FY${String(fy).padStart(2, "0")}`;
}

/** The quarters a period covers, in order. */
export function periodQuarters(p: string): string[] {
  const m = RE.exec(p);
  if (!m) throw new Error(`not a fiscal period: ${p}`);
  const fy = m[2]!;
  const q = (n: number) => `Q${n}FY${fy}`;
  switch (m[1]) {
    case undefined: return [q(1), q(2), q(3), q(4)];
    case "H1": return [q(1), q(2)];
    case "H2": return [q(3), q(4)];
    case "9M": return [q(1), q(2), q(3)];
    default: return [m[1]! + `FY${fy}`];
  }
}

export const lastQuarter = (p: string) => periodQuarters(p).at(-1)!;

/** Same period a year earlier: FY27 → FY26, H1FY27 → H1FY26. */
export function priorYear(p: string): string {
  const m = RE.exec(p)!;
  return `${m[1] ?? ""}FY${String(Number(m[2]) - 1).padStart(2, "0")}`;
}

/** "Q2FY27" → "Q2 FY27", "FY27" → "FY27". */
export function periodLabel(p: string): string {
  return p.replace(/^(Q[1-4]|H[12]|9M)(FY)/, "$1 $2");
}

/** Name for the first n quarters of a fiscal year: 1 → Q1, 2 → H1, 3 → 9M, 4 → FY. */
export function partialLabel(quarters: string[]): string {
  const fy = quarters[0]!.slice(2);
  const first = quarters[0]!.startsWith("Q1");
  if (first && quarters.length === 2) return `H1 ${fy}`;
  if (first && quarters.length === 3) return `9M ${fy}`;
  if (first && quarters.length === 4) return fy;
  return quarters.length === 1 ? periodLabel(quarters[0]!) : `${periodLabel(quarters[0]!)}–${quarters.at(-1)!.slice(0, 2)}`;
}

/** "FY'27", "FY 2027", "fy27", "Q3 FY27", "H2FY'27" → canonical, or null. */
export function normalizePeriod(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.toUpperCase().replace(/[’'`\s-]/g, "");
  const m = /^(Q[1-4]|H[12]|9M)?FY(?:20)?(\d{2})$/.exec(s);
  return m ? `${m[1] ?? ""}FY${m[2]}` : null;
}
