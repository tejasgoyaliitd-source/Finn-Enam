/**
 * Regressions from a live run over 14 days of real BSE announcements for the demo
 * portfolio. Each record keeps BSE's real field pattern: CATEGORYNAME / SUBCATNAME carry the
 * signal, NEWSSUB is either a real title or the generic "Announcement under Regulation 30
 * (LODR)-<sub-category>", and HEADLINE is the first line of the letter, often pure boilerplate.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { classify, detectAlwaysAct, normalizeBse, scoreFiling, templateHeadline } from "../src/index";
import { bseSubject } from "../src/sources/bse";
import { FakeLog } from "./fakes";

const hash = { sha256: async (d: Uint8Array | string) => createHash("sha256").update(d).digest("hex") };

interface Case {
  name: string;
  raw: { CATEGORYNAME: string; SUBCATNAME: string; NEWSSUB: string; HEADLINE: string };
  category: string;
  tier: "act" | "read" | "routine";
  headline: string;
}

const CASES: Case[] = [
  {
    name: "strike notice with a boilerplate headline",
    raw: { CATEGORYNAME: "Company Update", SUBCATNAME: "Strikes /Lockouts / Disturbances",
      NEWSSUB: "Announcement under Regulation 30 (LODR)-Strikes /Lockouts / Disturbances", HEADLINE: "Intimation u/r 30" },
    category: "disruption", tier: "read", headline: "Strikes / Lockouts / Disturbances update",
  },
  {
    name: "acquisition whose headline is the letter's opening line",
    raw: { CATEGORYNAME: "Company Update", SUBCATNAME: "Acquisition",
      NEWSSUB: "Announcement under Regulation 30 (LODR)-Acquisition",
      HEADLINE: "Please find attached an intimation under Regulation 30 of the SEBI (Listing Obligations and Disclosure Requirements) Regulations, 2015" },
    category: "m_and_a", tier: "read", headline: "Acquisition update",
  },
  {
    name: "commercial paper repayment is treasury housekeeping",
    raw: { CATEGORYNAME: "Company Update", SUBCATNAME: "General",
      NEWSSUB: "Intimation Of Repayment Of Commercial Paper (CP)", HEADLINE: "Intimation of Repayment of Commercial Paper (CP)" },
    category: "routine", tier: "routine", headline: "Repayment Of Commercial Paper (CP)",
  },
  {
    name: "results with 'Un-Audited' in the title",
    raw: { CATEGORYNAME: "Result", SUBCATNAME: "Financial Results",
      NEWSSUB: "Un-Audited Standalone And Consolidated Financial Results For The Quarter Ended September 30, 2026",
      HEADLINE: "Please find enclosed un-audited standalone and consolidated financial results" },
    category: "results", tier: "read", headline: "Q2 FY27 results announced",
  },
  {
    name: "board outcome approving results",
    raw: { CATEGORYNAME: "Board Meeting", SUBCATNAME: "Outcome of Board Meeting",
      NEWSSUB: "Board Meeting Outcome for Outcome of the Board meeting for the second Quarter and half year ended 30 September 2026",
      HEADLINE: "Outcome of the Board meeting for the second Quarter and half year ended 30 September 2026" },
    category: "results", tier: "read", headline: "Q2 FY27 results announced",
  },
  {
    name: "analyst meet intimation in BSE's sub-category wording",
    raw: { CATEGORYNAME: "Company Update", SUBCATNAME: "Analyst / Investor Meet",
      NEWSSUB: "Announcement under Regulation 30 (LODR)-Analyst / Investor Meet - Intimation",
      HEADLINE: "In terms of Regulation 30 and other applicable provisions of the SEBI (Listing Obligations and Disclosure Requirements)" },
    category: "routine", tier: "routine", headline: "Investor meetings scheduled",
  },
  {
    name: "'Analyst(s)/Investor(s)' plural form",
    raw: { CATEGORYNAME: "Company Update", SUBCATNAME: "General",
      NEWSSUB: "Intimation of Institutional Analyst(s)/Investor(s) meet", HEADLINE: "Intimation of Institutional Analyst(s)/Investor(s) meet" },
    category: "routine", tier: "routine", headline: "Investor meetings scheduled",
  },
  {
    name: "postal ballot outcome is not an AGM",
    raw: { CATEGORYNAME: "AGM/EGM", SUBCATNAME: "Postal Ballot",
      NEWSSUB: "Shareholder Meeting / Postal Ballot-Outcome of Postal_Ballot", HEADLINE: "Please find enclosed the voting results of Postal Ballot" },
    category: "postal_ballot", tier: "read", headline: "Postal ballot results declared",
  },
  {
    name: "auditor appointment (no exit) is Read, with the informative subject kept",
    raw: { CATEGORYNAME: "Company Update", SUBCATNAME: "Appointment of Statutory Auditor/s",
      NEWSSUB: "Announcement under Regulation 30 (LODR)-Appointment of Statutory Auditor/s", HEADLINE: "Intimation of Appointment of Statutory Auditor" },
    category: "auditor_change", tier: "read", headline: "Appointment of Statutory Auditor",
  },
  {
    name: "board meeting scheduled, BSE phrasing",
    raw: { CATEGORYNAME: "Board Meeting", SUBCATNAME: "Board Meeting Intimation",
      NEWSSUB: "Board Meeting Intimation for Considering Financial Results",
      HEADLINE: "Company Ltd has informed BSE that the meeting of the Board of Directors of the Company is scheduled on 14/11/2026" },
    category: "results", tier: "routine", headline: "Board meeting date announced",
  },
];

for (const c of CASES) {
  test(`real BSE shape: ${c.name}`, async () => {
    const n = await normalizeBse(hash, "MARICO", { ...c.raw, NEWSID: "x", News_submission_dt: "2026-11-10T12:00:00" });
    assert.ok(n.ok);
    const f = n.filing;
    const cls = await classify(f, undefined, new FakeLog());
    assert.equal(cls.method, "rule", `${c.name}: should be decided by rules (${cls.note})`);
    assert.equal(cls.category, c.category);
    const act = detectAlwaysAct(f.exch_category, f.subject);
    const s = scoreFiling({ category: cls.category, sub_kind: cls.sub_kind, routine: cls.routine, triggers: act.triggers, rotation: act.rotation, weight: 4.5 });
    assert.equal(s.tier, c.tier);
    const h = templateHeadline({ subject: f.subject, exch_category: f.exch_category, category: cls.category, sub_kind: cls.sub_kind, triggers: act.triggers, rotation: act.rotation });
    assert.equal(h, c.headline);
  });
}

test("bseSubject: specific NEWSSUB wins; generic Regulation 30 NEWSSUB falls back to HEADLINE; prefix stripped", () => {
  assert.equal(bseSubject({ NEWSSUB: "Announcement under Regulation 30 (LODR)-Acquisition", HEADLINE: "Acquisition of 51% stake" }), "Acquisition of 51% stake");
  assert.equal(bseSubject({ NEWSSUB: "Dixon Technologies (India) Ltd - 540699 - Board Meeting Outcome", HEADLINE: "Please find enclosed" }), "Board Meeting Outcome");
  assert.equal(bseSubject({ NEWSSUB: null, HEADLINE: "Only a headline" }), "Only a headline");
});

test("real BSE shape: CIRP update whose NEWSSUB only repeats the category uses the HEADLINE", async () => {
  const raw = {
    CATEGORYNAME: "Company Update", SUBCATNAME: "Updates - Corporate Insolvency Resolution Process (CIRP)",
    NEWSSUB: "Corporate Insolvency Resolution Process (CIRP)-Updates - Corporate Insolvency Resolution Process (CIRP)",
    HEADLINE: "Order passed by NCLAT setting aside the order of NCLT Ahmedabad bench dated October 07, 2026",
    NEWSID: "x", News_submission_dt: "2026-10-30T12:00:00",
  };
  const n = await normalizeBse(hash, "POLYCAB", raw);
  assert.ok(n.ok);
  assert.match(n.filing.subject, /^Order passed by NCLAT setting aside/);
  const cls = await classify(n.filing, undefined, new FakeLog());
  const act = detectAlwaysAct(n.filing.exch_category, n.filing.subject);
  assert.deepEqual(act.triggers.map((t) => t.id), ["insolvency"], "still Act: insolvency litigation is material");
  const h = templateHeadline({ subject: n.filing.subject, exch_category: n.filing.exch_category, category: cls.category, sub_kind: cls.sub_kind, triggers: act.triggers, rotation: act.rotation });
  assert.equal(h, "Insolvency order set aside or stayed on appeal");
});
