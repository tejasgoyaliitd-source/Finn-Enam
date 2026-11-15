import type { ApiErrorCode } from "@finn/shared";

/**
 * The only network client in the web app. It talks to finn-api and nothing else.
 * In dev, /v1 is proxied by Vite to the local API; in production VITE_API_URL points at it.
 */
const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";

export interface Envelope<T> {
  ok: true;
  data: T;
  /** When the data behind this response was last refreshed (IST). */
  as_of: string;
  stale: boolean;
  stale_reason: string | null;
}

export class ApiRequestError extends Error {
  constructor(
    readonly code: ApiErrorCode | "offline",
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
  get offline() {
    return this.code === "offline";
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<Envelope<T>> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { ...init, headers: { accept: "application/json", ...(init?.body ? { "content-type": "application/json" } : {}), ...init?.headers } });
  } catch {
    throw new ApiRequestError("offline", 0, "FINN could not be reached. Check the connection.");
  }
  const body = (await res.json().catch(() => null)) as (Envelope<T> | { ok: false; error: { code: ApiErrorCode; message: string } }) | null;
  if (!res.ok || !body || body.ok !== true) {
    const err = body && body.ok === false ? body.error : null;
    // No JSON body means the API itself didn't answer (proxy or gateway error).
    const fallback = res.status >= 500 ? "FINN's server is not responding. Try again in a minute." : `The request failed (${res.status}).`;
    throw new ApiRequestError(err?.code ?? "internal", res.status, err?.message ?? fallback);
  }
  return body;
}
