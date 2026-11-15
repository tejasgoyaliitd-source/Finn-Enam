import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeGovernanceStrip,
  detectGovernanceFlagsInFiling,
  formatFlagDate,
  type StoredFiling,
} from "../../src/index";

const AS_OF = "2026-11-15T12:00:00+05:30" as const;

function mkFiling(id: number, symbol: string, subject: string, exch_category: string, filed_at: string): StoredFiling {
  return {
    id,
    symbol,
    exchange: "NSE",
    exch_category,
    subject,
    filed_at: filed_at as any,
    dedupe_key: `key_${id}`,
    subject_hash: null,
    duplicate_of: null,
    analysis: null,
  };
}

test("Governance strip: 0 flags in trailing 12 months outputs clean line", () => {
  const filings: StoredFiling[] = [
    mkFiling(1, "KPITTECH", "Earnings call transcript for Q2 FY27", "Earnings Call", "2026-10-25T14:00:00+05:30"),
    mkFiling(2, "KPITTECH", "Investor presentation on financial results", "Investor Presentation", "2026-10-25T14:30:00+05:30"),
  ];

  const strip = computeGovernanceStrip("KPITTECH", filings, { as_of: AS_OF });
  assert.equal(strip.clean, true);
  assert.equal(strip.count, 0);
  assert.equal(strip.line, "No governance flags in 12 months");
  assert.deepEqual(strip.flags, []);
});

test("Governance strip: filings older than 12 months are excluded from lookback", () => {
  const filings: StoredFiling[] = [
    // 14 months ago (Sep 2025 vs Nov 2026 as_of)
    mkFiling(1, "DIXON", "Resignation of Chief Financial Officer", "Change in Management", "2025-09-10T11:00:00+05:30"),
  ];

  const strip = computeGovernanceStrip("DIXON", filings, { as_of: AS_OF });
  assert.equal(strip.clean, true);
  assert.equal(strip.count, 0);
  assert.equal(strip.line, "No governance flags in 12 months");
});

test("Governance strip: auditor resignation flagged, mandatory rotation ignored", () => {
  // Real auditor resignation
  const fResign = mkFiling(1, "POLYCAB", "Resignation of Statutory Auditors BSR & Co. LLP", "Auditor Change", "2026-06-15T10:00:00+05:30");
  const flags1 = detectGovernanceFlagsInFiling(fResign);
  assert.equal(flags1.length, 1);
  assert.equal(flags1[0]?.kind, "auditor_resignation");
  assert.equal(flags1[0]?.detail, "Statutory auditor resigned");

  // Mandatory rotation under Companies Act Section 139(2) is normal compliance
  const fRotation = mkFiling(2, "POLYCAB", "Appointment of Statutory Auditors pursuant to completion of second term / rotation under section 139(2)", "Auditor Change", "2026-06-16T10:00:00+05:30");
  const flags2 = detectGovernanceFlagsInFiling(fRotation);
  assert.equal(flags2.length, 0, "mandatory rotation should not produce a governance flag");
});

test("Governance strip: audit qualification flagged, unmodified opinion ignored", () => {
  const fQual = mkFiling(1, "ASTRAL", "Outcome of Board Meeting with qualified audit opinion on financial results", "Financial Results", "2026-05-20T17:00:00+05:30");
  const flags1 = detectGovernanceFlagsInFiling(fQual);
  assert.equal(flags1.length, 1);
  assert.equal(flags1[0]?.kind, "auditor_qualification");
  assert.equal(flags1[0]?.detail, "Auditor issued a qualified audit opinion");

  const fUnqual = mkFiling(2, "ASTRAL", "Financial results with unmodified audit report / no audit qualifications", "Financial Results", "2026-05-20T17:00:00+05:30");
  const flags2 = detectGovernanceFlagsInFiling(fUnqual);
  assert.equal(flags2.length, 0);
});

test("Governance strip: promoter pledge creation and invocation flagged, release ignored", () => {
  // Pledge creation
  const fPledge = mkFiling(1, "PAGEIND", "Disclosure under Regulation 31: creation of fresh pledge by promoter", "Pledging", "2026-02-10T12:00:00+05:30");
  const flags1 = detectGovernanceFlagsInFiling(fPledge);
  assert.equal(flags1.length, 1);
  assert.equal(flags1[0]?.kind, "pledge_created");

  // Pledge invocation
  const fInvocation = mkFiling(2, "PAGEIND", "Disclosure under Reg 31: lender invoked pledged shares of promoter group", "Pledging", "2026-03-12T12:00:00+05:30");
  const flags2 = detectGovernanceFlagsInFiling(fInvocation);
  assert.equal(flags2.length, 1);
  assert.equal(flags2[0]?.kind, "pledge_increased");
  assert.equal(flags2[0]?.detail, "Lender invoked pledged promoter shares");

  // Release of pledge is de-risking, not a red flag
  const fRelease = mkFiling(3, "PAGEIND", "Release of pledged shares / revocation of encumbrance by promoter", "Pledging", "2026-04-01T12:00:00+05:30");
  const flags3 = detectGovernanceFlagsInFiling(fRelease);
  assert.equal(flags3.length, 0);
});

test("Governance strip: promoter open market sales flagged", () => {
  const fSale = mkFiling(1, "TITAN", "Disclosures under Reg 29(2): sale of shares by promoter group in open market", "Insider Trading", "2026-07-14T15:00:00+05:30");
  const flags = detectGovernanceFlagsInFiling(fSale);
  assert.equal(flags.length, 1);
  assert.equal(flags[0]?.kind, "promoter_sell");
  assert.equal(flags[0]?.detail, "Promoter sold shares in open market");
});

test("Governance strip: senior leadership exits (CFO, CEO, MD, CS) flagged", () => {
  const fCfo = mkFiling(1, "POLYCAB", "Intimation of resignation of CFO Mr. Gandharv Tongia", "Change in Management", "2025-12-01T16:00:00+05:30");
  const flags = detectGovernanceFlagsInFiling(fCfo);
  assert.equal(flags.length, 1);
  assert.equal(flags[0]?.kind, "senior_exit");
  assert.equal(flags[0]?.detail, "CFO resigned (Gandharv Tongia)");

  const fCeo = mkFiling(2, "PERSISTENT", "Managing Director stepped down w.e.f. December 31", "Change in Management", "2025-12-15T18:00:00+05:30");
  const flags2 = detectGovernanceFlagsInFiling(fCeo);
  assert.equal(flags2.length, 1);
  assert.equal(flags2[0]?.kind, "senior_exit");
  assert.equal(flags2[0]?.detail, "Managing Director resigned");
});

test("Governance strip: regulatory orders and penalties flagged", () => {
  const fOrder = mkFiling(1, "HDFCBANK", "SEBI passed an adjudication order imposing a monetary penalty of Rs. 10 lakh", "Regulatory Order", "2026-08-10T14:00:00+05:30");
  const flags = detectGovernanceFlagsInFiling(fOrder);
  assert.equal(flags.length, 1);
  assert.equal(flags[0]?.kind, "regulatory_order");
  assert.equal(flags[0]?.detail, "Regulator issued an adjudication order");
});

test("Governance strip: material related party transaction flagged", () => {
  const fRpt = mkFiling(1, "DIXON", "Approval of material related party transaction with subsidiary entity", "General", "2026-09-05T11:00:00+05:30");
  const flags = detectGovernanceFlagsInFiling(fRpt);
  assert.equal(flags.length, 1);
  assert.equal(flags[0]?.kind, "related_party");
  assert.equal(flags[0]?.detail, "Material related party transaction disclosure");
});

test("Governance strip: multiple flags formatted calmly with dates and zero emojis", () => {
  const filings: StoredFiling[] = [
    mkFiling(1, "POLYCAB", "Intimation of resignation of CFO Mr. Gandharv Tongia", "Change in Management", "2025-12-01T16:00:00+05:30"),
    mkFiling(2, "POLYCAB", "SEBI adjudication order levying monetary penalty", "Regulatory Order", "2026-04-10T10:00:00+05:30"),
  ];

  const strip = computeGovernanceStrip("POLYCAB", filings, { as_of: AS_OF });
  assert.equal(strip.clean, false);
  assert.equal(strip.count, 2);
  // Checked chronological descending order: 10 Apr 2026 first, then 1 Dec 2025
  assert.ok(strip.line.includes("10 Apr 2026: Regulator issued an adjudication order"));
  assert.ok(strip.line.includes("1 Dec 2025: CFO resigned (Gandharv Tongia)"));
  // Ensure no sensational words or emojis
  assert.ok(!/[🚨⚠️❌🚩🔥]/.test(strip.line));
  assert.ok(!/\b(shocking|alarming|disaster|massive|terrible)\b/i.test(strip.line));
});

test("Governance strip: formatFlagDate formats ISO date cleanly", () => {
  assert.equal(formatFlagDate("2026-04-10T10:00:00+05:30"), "10 Apr 2026");
});
