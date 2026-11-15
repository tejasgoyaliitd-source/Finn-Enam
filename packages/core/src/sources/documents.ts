import { extractText, getDocumentProxy } from "unpdf";
import { BROWSER_HEADERS, HttpError, PoliteHttp } from "../http/polite";
import { describeError, runIngest, type RunOutcome } from "../ingest/run";
import type { CoreDeps, DocumentRow, HttpResponse } from "../ports";
import { stableUuid } from "../record/extract";

/**
 * BSE moves attachments from AttachLive to AttachHis after a few days, so a stored
 * AttachLive URL 404s later. Retry the archive path before giving up.
 */
export async function fetchAttachment(http: PoliteHttp, url: string): Promise<HttpResponse> {
  const headers = { ...BROWSER_HEADERS, accept: "application/pdf,*/*" };
  const res = await http.request({ url, headers });
  if (res.status === 404 && url.includes("/xml-data/corpfiling/AttachLive/")) {
    return http.request({ url: url.replace("/AttachLive/", "/AttachHis/"), headers });
  }
  return res;
}

/** Below this many non-space characters per page on average, treat the PDF as a scan. */
export const MIN_CHARS_PER_PAGE = 50;
const MAX_BYTES = 60 * 1024 * 1024;

export type PdfText =
  | { ok: true; pages: string[]; readable: boolean }
  | { ok: false; error: string };

/** Page-by-page text. Pure: takes bytes, touches nothing else. Never throws. */
export async function extractPdfPages(bytes: Uint8Array): Promise<PdfText> {
  try {
    // pdf.js may detach the buffer it's given, so hand it a copy.
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: false });
    const pages = text.map((t) => t.replace(/[ \t]+/g, " ").trim());
    const chars = pages.reduce((n, p) => n + p.replace(/\s/g, "").length, 0);
    return { ok: true, pages, readable: pages.length > 0 && chars / pages.length >= MIN_CHARS_PER_PAGE };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}

export function isPdf(bytes: Uint8Array): boolean {
  // "%PDF" may follow a few junk bytes; the spec allows it within the first 1 KB.
  const head = String.fromCharCode(...bytes.subarray(0, 1024));
  return head.includes("%PDF-");
}

export interface DocumentInput {
  symbol: string;
  type: DocumentRow["type"];
  period: string | null;
  url: string;
}

export interface DocumentResult {
  sha256: string;
  /** "new" = extracted and stored; "already_have" = same bytes seen before, nothing done. */
  outcome: "new" | "already_have";
  readable: boolean | null;
  pages: number | null;
}

/**
 * Download → SHA-256 → skip if known → extract text per page → store text in the documents
 * bucket and metadata in `documents`. A scanned or unparseable PDF is recorded with
 * readable = false (and logged), not thrown, so one bad transcript never sinks a research run.
 */
export async function extractDocument(deps: CoreDeps, input: DocumentInput): Promise<RunOutcome<DocumentResult>> {
  return runIngest<DocumentResult>(deps, "documents", async () => {
    const http = new PoliteHttp(deps.http, deps.clock, deps.log, { timeoutMs: 60_000 }, deps.random);
    const res = await fetchAttachment(http, input.url);
    if (res.status !== 200) throw new HttpError(res.status, input.url);
    const bytes = await res.bytes();
    if (bytes.length > MAX_BYTES) throw new Error(`${input.url} is ${(bytes.length / 1e6).toFixed(1)} MB, over the limit`);
    if (!isPdf(bytes)) throw new Error(`${input.url} is not a PDF (content-type ${res.headers["content-type"] ?? "unknown"})`);

    const sha256 = await deps.hash.sha256(bytes);
    if (await deps.store.documentExists(sha256)) {
      deps.log.info("documents: already have this file, skipping", { sha256, url: input.url });
      return { rows: 0, result: { sha256, outcome: "already_have", readable: null, pages: null } };
    }

    const text = await extractPdfPages(bytes);
    const readable = text.ok && text.readable;
    const pages = text.ok ? text.pages.length : null;
    let note: string | null = null;
    if (!text.ok) {
      note = `${input.symbol} ${input.type}: could not parse PDF (${(text as any).error})`;
    } else if (!text.readable) {
      note = `${input.symbol} ${input.type} ${input.period ?? ""}: looks like a scan (no text layer); marked unreadable`.replace(/\s+:/, ":");
    }
    if (note) deps.log.warn(`documents: ${note}`, { url: input.url, sha256 });

    const storage_path = readable && text.ok ? await deps.store.saveDocumentText(sha256, text.pages) : null;
    const id = await stableUuid(deps.hash, `doc|${sha256}`);
    await deps.store.insertDocument({ id, ...input, sha256, pages, storage_path, readable });
    return { rows: 1, partial: note, result: { sha256, outcome: "new", readable, pages } };
  });
}
