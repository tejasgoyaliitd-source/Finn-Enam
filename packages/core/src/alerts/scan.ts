/**
 * Price and volume alerts, in code. A move alert fires when the day's log return is at least
 * `move_sigma` standard deviations of the previous 60 sessions' returns; a volume alert when
 * volume is at least `volume_x` times the previous 20 sessions' average.
 */

export interface PricePoint {
  date: string; // YYYY-MM-DD
  close: number;
  volume: number;
}

export interface AlertEvent {
  symbol: string;
  date: string;
  kind: "move_sigma" | "volume_x";
  /** Close-to-close change, %. */
  move_pct: number;
  /** Return in standard deviations of the trailing 60 sessions. */
  z: number;
  /** Volume as a multiple of the trailing 20-session average. */
  volume_multiple: number;
}

export interface ScanOptions {
  move_sigma: number;
  volume_x: number;
  /** How many of the most recent sessions to scan (1 = just the latest). */
  sessions: number;
}

const SIGMA_WINDOW = 60;
const VOLUME_WINDOW = 20;

export function scanPriceAlerts(symbol: string, prices: PricePoint[], o: ScanOptions): AlertEvent[] {
  const p = [...prices].sort((a, b) => a.date.localeCompare(b.date));
  const r = p.map((x, i) => (i === 0 ? 0 : Math.log(x.close / p[i - 1]!.close)));
  const out: AlertEvent[] = [];
  for (let i = Math.max(SIGMA_WINDOW + 1, p.length - o.sessions); i < p.length; i++) {
    const window = r.slice(i - SIGMA_WINDOW, i);
    const mean = window.reduce((a, b) => a + b, 0) / window.length;
    const sd = Math.sqrt(window.reduce((a, b) => a + (b - mean) ** 2, 0) / (window.length - 1));
    const vols = p.slice(Math.max(0, i - VOLUME_WINDOW), i).map((x) => x.volume);
    const avgVol = vols.reduce((a, b) => a + b, 0) / (vols.length || 1);
    const z = sd > 0 ? r[i]! / sd : 0;
    const vx = avgVol > 0 ? p[i]!.volume / avgVol : 0;
    const base = {
      symbol,
      date: p[i]!.date,
      move_pct: Math.round((p[i]!.close / p[i - 1]!.close - 1) * 1000) / 10,
      z: Math.round(z * 10) / 10,
      volume_multiple: Math.round(vx * 10) / 10,
    };
    if (Math.abs(z) >= o.move_sigma) out.push({ ...base, kind: "move_sigma" });
    if (vx >= o.volume_x) out.push({ ...base, kind: "volume_x" });
  }
  return out;
}

/** "9×", "2.5×": multiples rounded for reading, not for maths. */
const times = (x: number) => `${Math.abs(x) >= 10 ? Math.round(Math.abs(x)) : Math.round(Math.abs(x) * 10) / 10}×`;
const pctWord = (p: number) => `${Math.round(Math.abs(p) * 10) / 10}%`;

/**
 * Plain language, one sentence: "Fell 6%, 3× its usual daily move, on 4× normal volume."
 * A move and a volume spike on the same day read as one event.
 */
export function describeAlerts(events: AlertEvent[]): string {
  const move = events.find((e) => e.kind === "move_sigma");
  const vol = events.find((e) => e.kind === "volume_x");
  const e = move ?? vol;
  if (!e) return "";
  if (move) {
    return `${move.move_pct >= 0 ? "Rose" : "Fell"} ${pctWord(move.move_pct)}, ${times(move.z)} its usual daily move${vol ? `, on ${times(vol.volume_multiple)} normal volume` : ""}.`;
  }
  const dir = e.move_pct === 0 ? "price unchanged" : `price ${e.move_pct > 0 ? "up" : "down"} ${pctWord(e.move_pct)}`;
  return `Traded ${times(e.volume_multiple)} its normal volume, ${dir}.`;
}

export function describeAlert(e: AlertEvent): string {
  return describeAlerts([e]);
}
