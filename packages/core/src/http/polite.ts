import type { Clock, HttpClient, HttpRequest, HttpResponse, Logger } from "../ports";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    message = `HTTP ${status} from ${url}`,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export class RequestBudgetExceeded extends Error {
  constructor(max: number) {
    super(`Request budget of ${max} exhausted for this run`);
    this.name = "RequestBudgetExceeded";
  }
}

export interface PoliteOptions {
  /** Minimum gap between requests to the same host. Default 1000 ms. */
  minIntervalMs?: number;
  /** Extra random delay on top of minIntervalMs, 0..jitterMs. Default 500 ms. */
  jitterMs?: number;
  /** Attempts for retryable failures (429, 5xx, network). Default 3. */
  maxAttempts?: number;
  /** Base for exponential backoff. Default 2000 ms → 2 s, 4 s, ... plus jitter. */
  backoffBaseMs?: number;
  /** Hard cap on requests through this client. Default 500. */
  maxRequests?: number;
  timeoutMs?: number;
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

/**
 * Wraps a transport with per-host throttling, backoff with jitter and a hard request cap.
 * One instance per source per run, so throttle state and budgets don't leak between sources.
 */
export class PoliteHttp {
  private readonly lastHit = new Map<string, number>();
  private count = 0;
  private readonly o: Required<PoliteOptions>;

  constructor(
    private readonly http: HttpClient,
    private readonly clock: Clock,
    private readonly log: Logger,
    opts: PoliteOptions = {},
    private readonly random: () => number = Math.random,
  ) {
    this.o = {
      minIntervalMs: opts.minIntervalMs ?? 1000,
      jitterMs: opts.jitterMs ?? 500,
      maxAttempts: opts.maxAttempts ?? 3,
      backoffBaseMs: opts.backoffBaseMs ?? 2000,
      maxRequests: opts.maxRequests ?? 500,
      timeoutMs: opts.timeoutMs ?? 20000,
    };
  }

  get requestCount(): number {
    return this.count;
  }

  /** Returns the response for any status; throws only on network failure after retries. */
  async request(req: HttpRequest): Promise<HttpResponse> {
    const host = hostOf(req.url);
    for (let attempt = 1; ; attempt++) {
      await this.waitTurn(host);
      if (++this.count > this.o.maxRequests) throw new RequestBudgetExceeded(this.o.maxRequests);
      try {
        const res = await this.http.request({ timeoutMs: this.o.timeoutMs, ...req });
        if (!RETRYABLE.has(res.status) || attempt >= this.o.maxAttempts) return res;
        this.log.warn("retrying", { url: req.url, status: res.status, attempt });
      } catch (err) {
        if (attempt >= this.o.maxAttempts) throw err;
        this.log.warn("retrying after network error", { url: req.url, attempt, error: String(err) });
      }
      await this.clock.sleep(this.o.backoffBaseMs * 2 ** (attempt - 1) + this.random() * this.o.backoffBaseMs);
    }
  }

  private async waitTurn(host: string): Promise<void> {
    const last = this.lastHit.get(host);
    if (last !== undefined) {
      const gap = this.o.minIntervalMs + this.random() * this.o.jitterMs;
      const wait = last + gap - this.clock.now().getTime();
      if (wait > 0) await this.clock.sleep(wait);
    }
    this.lastHit.set(host, this.clock.now().getTime());
  }
}

/** Minimal cookie jar for a single site: name → value, from Set-Cookie headers. */
export class CookieJar {
  private readonly cookies = new Map<string, string>();

  absorb(setCookies: string[]): void {
    for (const sc of setCookies) {
      const pair = sc.split(";", 1)[0] ?? "";
      const eq = pair.indexOf("=");
      if (eq <= 0) continue;
      this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }

  get size(): number {
    return this.cookies.size;
  }

  header(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  clear(): void {
    this.cookies.clear();
  }
}

export function hostOf(url: string): string {
  const m = /^https?:\/\/([^/?#]+)/i.exec(url);
  return (m?.[1] ?? url).toLowerCase();
}

/** Headers a desktop browser sends. Exchanges reject obviously scripted requests. */
export const BROWSER_HEADERS: Record<string, string> = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
  "accept-language": "en-IN,en-GB;q=0.9,en;q=0.8",
};
