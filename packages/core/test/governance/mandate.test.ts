import assert from "node:assert/strict";
import { test } from "node:test";
import {
  checkMandateBreachInFiling,
  checkSegmentMandate,
  classifySegmentActivity,
  type SegmentReportInput,
} from "../../src/index";

test("Mandate checker: company with 100% clean segments returns 'Within your exclusions'", () => {
  const input: SegmentReportInput = {
    symbol: "POLYCAB",
    period: "FY26",
    total_revenue: 18000,
    segments: [
      { name: "Wires and cables", revenue: 16000, page: 42 },
      { name: "Fast moving electrical goods (FMEG)", revenue: 2000, page: 42 },
    ],
  };

  const res = checkSegmentMandate(input);
  assert.equal(res.clean, true);
  assert.equal(res.line, "Within your exclusions");
  assert.deepEqual(res.breaches, []);
});

test("Mandate checker: alcohol segment tags exact percentage and page citation", () => {
  const input: SegmentReportInput = {
    symbol: "UBBL",
    period: "FY26",
    total_revenue: 10000,
    segments: [
      { name: "Alcoholic beverages", revenue: 1200, page: 34 },
      { name: "Non-alcoholic beverages and food", revenue: 8800, page: 34 },
    ],
  };

  const res = checkSegmentMandate(input);
  assert.equal(res.clean, false);
  assert.equal(res.breaches.length, 1);
  assert.equal(res.breaches[0]?.activity, "alcohol");
  assert.equal(res.breaches[0]?.revenue_pct, 12);
  assert.equal(res.breaches[0]?.page, 34);
  assert.equal(res.line, "About 12% of revenue from Alcoholic beverages (AR FY26, p.34)");
});

test("Mandate checker: classifies all 4 fund exclusions accurately", () => {
  assert.equal(classifySegmentActivity("Single malt distillery & breweries"), "alcohol");
  assert.equal(classifySegmentActivity("Cigarettes, cigars and nicotine products"), "tobacco");
  assert.equal(classifySegmentActivity("Online betting & real money gaming platform"), "gambling");
  assert.equal(classifySegmentActivity("Finished leather goods and tannery division"), "animal_harm");
  assert.equal(classifySegmentActivity("Software services and consulting"), null);
});

test("Mandate checker: multiple excluded segments listed clearly", () => {
  const input: SegmentReportInput = {
    symbol: "CONGLOM",
    period: "FY26",
    total_revenue: 1000,
    default_page: 55,
    segments: [
      { name: "Beer & spirits", revenue: 150 },
      { name: "Leather accessories", revenue: 80 },
      { name: "IT services", revenue: 770 },
    ],
  };

  const res = checkSegmentMandate(input);
  assert.equal(res.clean, false);
  assert.equal(res.breaches.length, 2);
  assert.ok(res.line.includes("About 15% of revenue from Beer & spirits (AR FY26, p.55)"));
  assert.ok(res.line.includes("About 8% of revenue from Leather accessories (AR FY26, p.55)"));
});

test("Mandate checker: M&A acquisition into excluded business triggers Act-tier breach", () => {
  // Acquisition of a brewery
  const f1 = {
    subject: "Announcement under Reg 30: Acquisition of 100% equity stake in Craft Breweries India Pvt Ltd",
    exch_category: "Corporate Action / Acquisition",
  };
  const b1 = checkMandateBreachInFiling(f1);
  assert.equal(b1.is_breach, true);
  assert.equal(b1.tier, "act");
  assert.equal(b1.activity, "alcohol");
  assert.ok(b1.reason?.includes("Mandate breach: acquisition in alcoholic beverages"));

  // Joint venture in gaming / gambling
  const f2 = {
    subject: "Execution of joint venture agreement to acquire online real money gaming operations",
    exch_category: "Joint Venture",
  };
  const b2 = checkMandateBreachInFiling(f2);
  assert.equal(b2.is_breach, true);
  assert.equal(b2.tier, "act");
  assert.equal(b2.activity, "real_money_gaming");

  // Acquisition of casino operations
  const fCasino = {
    subject: "Binding agreement to acquire offshore casino and gaming operations in Goa",
    exch_category: "Corporate Action / Acquisition",
  };
  const bCasino = checkMandateBreachInFiling(fCasino);
  assert.equal(bCasino.is_breach, true);
  assert.equal(bCasino.tier, "act");
  assert.equal(bCasino.activity, "gambling");

  // Acquisition in electronics manufacturing (clean)
  const f3 = {
    subject: "Acquisition of 51% stake in Ismartu India Private Limited (mobile manufacturing)",
    exch_category: "Corporate Action / Acquisition",
  };
  const b3 = checkMandateBreachInFiling(f3);
  assert.equal(b3.is_breach, false);
});
