import { z } from "zod";
import { IstDateTime } from "./primitives";

export const ApiErrorCode = z.enum([
  "bad_request",
  "unauthorized",
  "not_found",
  "rate_limited",
  /** NSE/BSE/LLM provider unreachable. */
  "upstream_unavailable",
  /** Research job hasn't produced this yet. */
  "data_not_ready",
  "internal",
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCode>;

export const ApiError = z.strictObject({
  code: ApiErrorCode,
  /** Written for the screen, e.g. "NSE has not responded since 14:10; showing filings up to then." */
  message: z.string().min(1),
  retry_after_s: z.number().int().positive().optional(),
});
export type ApiError = z.infer<typeof ApiError>;

/**
 * Every data response says exactly how fresh it is. `as_of` is the time the underlying
 * data was last refreshed (not the time of the request). When `stale` is true,
 * `stale_reason` explains why in plain language.
 */
const freshness = {
  as_of: IstDateTime,
  stale: z.boolean(),
  stale_reason: z.string().min(1).nullable(),
};

const staleNeedsReason = (r: { stale: boolean; stale_reason: string | null }) =>
  r.stale === (r.stale_reason !== null);
const staleMsg = { message: "stale_reason is required exactly when stale is true", path: ["stale_reason"] };

export const ApiFailure = z.strictObject({
  ok: z.literal(false),
  error: ApiError,
});
export type ApiFailure = z.infer<typeof ApiFailure>;

export const apiSuccess = <T extends z.ZodType>(data: T) =>
  z.strictObject({ ok: z.literal(true), data, ...freshness }).refine(staleNeedsReason, staleMsg);

export const apiResponse = <T extends z.ZodType>(data: T) =>
  z.discriminatedUnion("ok", [apiSuccess(data), ApiFailure]);

export type ApiSuccess<T> = {
  ok: true;
  data: T;
  as_of: IstDateTime;
  stale: boolean;
  stale_reason: string | null;
};
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export const SourceHealth = z.strictObject({
  source: z.enum(["nse", "bse", "yahoo", "screener", "gemini", "groq"]),
  last_success_at: IstDateTime.nullable(),
  degraded: z.boolean(),
  note: z.string().nullable(),
});
export type SourceHealth = z.infer<typeof SourceHealth>;

export const HealthPayload = z.strictObject({
  sources: z.array(SourceHealth),
});
export type HealthPayload = z.infer<typeof HealthPayload>;
