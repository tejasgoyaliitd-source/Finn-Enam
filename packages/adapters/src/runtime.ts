import { createHash } from "node:crypto";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";
import type { Clock, Hasher, HttpClient, HttpRequest, HttpResponse, Logger } from "@finn/core";

/** undici (fetch) rejects responses with malformed headers; BSE's edge sometimes sends one. */
function isParserError(err: unknown): boolean {
  const cause = (err as { cause?: { name?: string; message?: string; code?: string } })?.cause;
  return cause?.name === "HTTPParserError" || /^HPE_/.test(cause?.code ?? "") || /does not match the HTTP/.test(cause?.message ?? "");
}

/** Same request through node:http with the lenient header parser. Used only as a fallback. */
function lenientRequest(req: HttpRequest, redirects = 5): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL(req.url);
    const send = url.protocol === "http:" ? httpRequest : httpsRequest;
    const r = send(
      url,
      {
        method: req.method ?? "GET",
        headers: { ...req.headers, "accept-encoding": "gzip, deflate, br" },
        insecureHTTPParser: true,
        timeout: req.timeoutMs ?? 20_000,
      },
      (res: IncomingMessage) => {
        const status = res.statusCode ?? 0;
        const location = res.headers.location;
        if (status >= 300 && status < 400 && location && redirects > 0) {
          res.resume();
          resolve(lenientRequest({ ...req, url: new URL(location, url).toString() }, redirects - 1));
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("error", reject);
        res.on("end", () => {
          try {
            let body = Buffer.concat(chunks);
            const enc = String(res.headers["content-encoding"] ?? "").toLowerCase();
            if (enc === "gzip") body = gunzipSync(body);
            else if (enc === "deflate") body = inflateSync(body);
            else if (enc === "br") body = brotliDecompressSync(body);
            const headers: Record<string, string> = {};
            for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : v;
            const setCookies = res.headers["set-cookie"] ?? [];
            resolve({
              status,
              url: url.toString(),
              headers,
              setCookies,
              text: async () => body.toString("utf8"),
              bytes: async () => new Uint8Array(body),
            });
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    r.on("timeout", () => r.destroy(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" })));
    r.on("error", reject);
    if (req.body) r.write(req.body);
    r.end();
  });
}

/** fetch transport, with a lenient fallback for malformed headers. Throttling, retries and cookies live in core. */
export const fetchHttpClient = (): HttpClient => ({
  async request(req) {
    try {
      return await fetchRequest(req);
    } catch (err) {
      if (isParserError(err)) return lenientRequest(req);
      throw err;
    }
  },
});

async function fetchRequest(req: HttpRequest): Promise<HttpResponse> {
  {
    const res = await fetch(req.url, {
      method: req.method ?? "GET",
      headers: req.headers,
      body: req.body,
      redirect: "follow",
      signal: AbortSignal.timeout(req.timeoutMs ?? 20_000),
    });
    const headers: Record<string, string> = {};
    const r = res as any;
    if (r.headers?.forEach) r.headers.forEach((v: string, k: string) => (headers[k.toLowerCase()] = v));
    return {
      status: r.status,
      url: r.url,
      headers,
      setCookies: r.headers?.getSetCookie ? r.headers.getSetCookie() : [],
      text: () => r.text(),
      bytes: async () => new Uint8Array(await r.arrayBuffer()),
    };
  }
}

export const systemClock = (): Clock => ({
  now: () => new Date(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
});

export const nodeHasher = (): Hasher => ({
  sha256: async (data) => createHash("sha256").update(data).digest("hex"),
});

/** One line per event: readable in a terminal, greppable in Vercel logs. */
export const consoleLogger = (opts: { quiet?: boolean } = {}): Logger => {
  const line = (level: string, msg: string, fields?: Record<string, unknown>) =>
    `${new Date().toISOString().slice(11, 19)} ${level} ${msg}${fields && Object.keys(fields).length ? " " + JSON.stringify(fields) : ""}`;
  return {
    info: (m, f) => !opts.quiet && console.log(line("info ", m, f)),
    warn: (m, f) => console.warn(line("WARN ", m, f)),
    error: (m, f) => console.error(line("ERROR", m, f)),
  };
};
