import { createHash } from "node:crypto";
import { MemoryStore, type CompanyRef, type CoreDeps, type HttpRequest, type HttpResponse, type Logger } from "../src/index";

export interface FakeReply {
  status?: number;
  body?: string | Uint8Array;
  setCookies?: string[];
  headers?: Record<string, string>;
  url?: string;
}

export class FakeClock {
  readonly sleeps: number[] = [];
  constructor(private t = Date.parse("2026-11-15T12:00:00+05:30")) {}
  now = () => new Date(this.t);
  sleep = async (ms: number) => {
    this.sleeps.push(ms);
    this.t += ms;
  };
}

export class FakeLog implements Logger {
  readonly lines: string[] = [];
  info = (m: string) => void this.lines.push(`info ${m}`);
  warn = (m: string) => void this.lines.push(`warn ${m}`);
  error = (m: string) => void this.lines.push(`error ${m}`);
}

/** Routes each request to a handler; records every request for assertions. */
export function fakeHttp(route: (req: HttpRequest) => FakeReply) {
  const requests: HttpRequest[] = [];
  return {
    requests,
    request: async (req: HttpRequest): Promise<HttpResponse> => {
      requests.push(req);
      const r = route(req);
      const body = r.body ?? "";
      return {
        status: r.status ?? 200,
        url: r.url ?? req.url,
        headers: r.headers ?? {},
        setCookies: r.setCookies ?? [],
        text: async () => (typeof body === "string" ? body : new TextDecoder().decode(body)),
        bytes: async () => (typeof body === "string" ? new TextEncoder().encode(body) : body),
      };
    },
  };
}

export function makeDeps(route: (req: HttpRequest) => FakeReply, companies: CompanyRef[] = []) {
  const http = fakeHttp(route);
  const clock = new FakeClock();
  const log = new FakeLog();
  const store = new MemoryStore(companies);
  const deps: CoreDeps = {
    http,
    clock,
    log,
    store,
    hash: { sha256: async (d) => createHash("sha256").update(d).digest("hex") },
    runner: "manual",
    random: () => 0.5,
  };
  return { deps, http, clock, log, store };
}

/** Minimal valid PDF: one page per entry, each drawing its string in Helvetica (empty = blank page). */
export function makePdf(pages: string[]): Uint8Array {
  const objs: string[] = [];
  const kids: string[] = [];
  const font = 3 + pages.length * 2;
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  pages.forEach((text, i) => {
    const page = 3 + i * 2;
    const content = page + 1;
    kids.push(`${page} 0 R`);
    const all = text.split("\n");
    // Fit every line on the page: text drawn below the page edge is dropped by PDF readers.
    const lead = Math.min(14, 720 / Math.max(all.length, 1));
    const size = Math.max(1, Math.min(11, lead * 0.8));
    const lines = all
      .map((l, j) => `BT /F1 ${size.toFixed(2)} Tf 72 ${(740 - j * lead).toFixed(2)} Td (${l.replace(/[()\\]/g, "\\$&")}) Tj ET`)
      .join("\n");
    const stream = text ? lines : "";
    objs[page] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${content} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`;
    objs[content] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  objs[2] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages.length} >>`;
  objs[font] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let i = 1; i < objs.length; i++) {
    offsets[i] = out.length;
    out += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objs.length; i++) out += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}
