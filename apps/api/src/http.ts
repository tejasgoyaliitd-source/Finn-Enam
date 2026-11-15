import type { Context, MiddlewareHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ApiErrorCode, IstDateTime } from "@finn/shared";

export interface Freshness {
  as_of: IstDateTime;
  stale: boolean;
  stale_reason: string | null;
}

/** The standard envelope: { ok, data, as_of (IST), stale, stale_reason }. */
export function ok<T>(c: Context, data: T, f: Freshness, status: ContentfulStatusCode = 200) {
  return c.json({ ok: true as const, data, as_of: f.as_of, stale: f.stale, stale_reason: f.stale_reason }, status);
}

/** Thrown anywhere in a route; turned into the error contract by app.onError. */
export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: ApiErrorCode,
    message: string,
    readonly retryAfterS?: number,
  ) {
    super(message);
  }
}

export function fail(c: Context, e: ApiError) {
  if (e.retryAfterS) c.header("Retry-After", String(e.retryAfterS));
  return c.json(
    { ok: false as const, error: { code: e.code, message: e.message, ...(e.retryAfterS ? { retry_after_s: e.retryAfterS } : {}) } },
    e.status,
  );
}

/** CDN caching for reads: serve from the edge for s-maxage, refresh in the background for swr. */
export const cdn =
  (sMaxAge = 60, swr = 600): MiddlewareHandler =>
  async (c, next) => {
    await next();
    if (c.res.status === 200) c.header("Cache-Control", `public, s-maxage=${sMaxAge}, stale-while-revalidate=${swr}`);
  };

export const noStore: MiddlewareHandler = async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
};

/** Query-string number with bounds; a bad value is a 400, never a silent default. */
export function numParam(c: Context, name: string, def: number, min: number, max: number): number {
  const raw = c.req.query(name);
  if (raw === undefined || raw === "") return def;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) throw new ApiError(400, "bad_request", `${name} must be a number between ${min} and ${max}`);
  return n;
}
