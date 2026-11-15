import assert from "node:assert/strict";
import { test } from "node:test";
import {
  countSeniorExits,
  extractPeopleFromText,
  PeopleExtractionSchema,
} from "../../src/index";

const AS_OF = "2026-11-15T12:00:00+05:30" as const;

test("People extractor: SEBI LODR appointment disclosure parses incoming name, role, effective date and prior roles", () => {
  const disclosure = `
    Disclosure pursuant to Regulation 30 of the SEBI (Listing Obligations and Disclosure Requirements) Regulations, 2015.
    1. Name of Key Managerial Personnel: Mr. Niyant Maru
    2. Designation: Chief Financial Officer
    3. Reason for change: Appointment as Chief Financial Officer (Key Managerial Personnel)
    4. Date of appointment: w.e.f. November 1, 2025 for a term of one year
    5. Brief profile: Mr. Niyant Maru brings over 30 years of extensive experience in corporate finance, treasury, taxation and M&A. Prior to this role, he served as CFO at V-Guard Industries and Vice President of Finance at Atul Ltd.
  `;

  const results = extractPeopleFromText(disclosure, 2);
  assert.equal(results.length, 1);
  const p = results[0]!;
  assert.equal(p.name, "Niyant Maru");
  assert.equal(p.role, "Chief Financial Officer");
  assert.equal(p.action, "appointed");
  assert.equal(p.effective_date, "2025-11-01");
  assert.ok(p.prior_roles.some((r) => r.includes("CFO at V-Guard") || r.includes("Vice President")));
  assert.equal(p.source_page, 2);

  // Validates with PeopleExtractionSchema
  assert.ok(PeopleExtractionSchema.safeParse({ events: results }).success);
});

test("People extractor: SEBI LODR resignation disclosure parses stated reason and tenure", () => {
  const resignation = `
    Outcome of Board Meeting held on October 24, 2025.
    The Board of Directors took on record the resignation tendered by Mr. Gandharv Tongia from the position of Chief Financial Officer.
    Details as required under Regulation 30:
    Name: Gandharv Tongia
    Designation: Chief Financial Officer
    Reason for change: Resignation due to personal reasons and to pursue opportunities outside the organisation
    Date of cessation: effective from close of business hours on October 31, 2025
    Mr. Tongia has served for a tenure of 5 years with the company.
  `;

  const results = extractPeopleFromText(resignation, 1);
  assert.equal(results.length, 1);
  const p = results[0]!;
  assert.equal(p.name, "Gandharv Tongia");
  assert.equal(p.role, "Chief Financial Officer");
  assert.equal(p.action, "resigned");
  assert.equal(p.effective_date, "2025-10-31");
  assert.ok(p.stated_reason?.includes("personal reasons"));
  assert.equal(p.tenure_months, 60, "5 years = 60 months");
  assert.equal(p.source_page, 1);
});

test("Senior exit counter: counts exits in trailing 12 months with correct ordinal note", () => {
  // 1 exit
  const events1 = [
    { role: "Chief Financial Officer", action: "resigned", effective_date: "2026-06-15" },
  ];
  assert.deepEqual(countSeniorExits(events1, AS_OF), {
    count: 1,
    note: "First senior exit this year",
  });

  // 2 exits
  const events2 = [
    { role: "Chief Financial Officer", action: "resigned", effective_date: "2026-06-15" },
    { role: "Managing Director", action: "resigned", effective_date: "2026-08-20" },
  ];
  assert.deepEqual(countSeniorExits(events2, AS_OF), {
    count: 2,
    note: "Second senior exit this year",
  });

  // 3 exits
  const events3 = [
    ...events2,
    { role: "Company Secretary", action: "resigned", effective_date: "2026-10-01" },
  ];
  assert.deepEqual(countSeniorExits(events3, AS_OF), {
    count: 3,
    note: "Third senior exit this year",
  });

  // Non-senior exits (e.g. branch manager) or appointments are not counted
  const mixedEvents = [
    ...events2,
    { role: "Chief Executive Officer", action: "appointed", effective_date: "2026-09-01" },
    { role: "Regional Sales Manager", action: "resigned", effective_date: "2026-09-15" },
  ];
  assert.equal(countSeniorExits(mixedEvents, AS_OF).count, 2);

  // Exits older than 12 months are excluded
  const oldEvents = [
    { role: "Chief Financial Officer", action: "resigned", effective_date: "2024-05-10" },
  ];
  assert.deepEqual(countSeniorExits(oldEvents, AS_OF), {
    count: 0,
    note: "No senior exits this year",
  });
});

// Real annexure text from BSE filings (Oct–Nov 2026) that the old rules read as resignations:
// SEBI's template line "viz. appointment, re-appointment, resignation…" contains every action.
test("rules extractor: SEBI template boilerplate does not make an appointment a resignation", () => {
  const dixon =
    "ANNEXURE-A S.No. Particulars Details 1. Name of Director Mr. Prithvi Vachani 2. DIN 08247706 3. Reason for change viz. appointment, reappointment, resignation, removal, death or otherwise Appointment as an Additional Director in the capacity of Executive Director for a period of 5 (five) consecutive years 4. Date of appointment/ re- appointment/ cessation (as applicable) & term of appointment/ re-appointment Date of Appointment- 30-10-2026";
  const [p] = extractPeopleFromText(dixon, 3);
  assert.equal(p?.name, "Prithvi Vachani");
  assert.equal(p?.action, "appointed");
  assert.equal(p?.role, "Executive Director");
  assert.equal(p?.source_page, 3);
});

test("rules extractor: designation written after the name is the role, and names stop at 'and Mr'", () => {
  const astral =
    "the following employees of the Company, have been designated as Senior Management Personnel in terms of Regulation 16(1)(d) of the SEBI Listing Regulations, with effect from November 5, 2026. a) Mr. Ritesh Patel, Associate Vice President – Technical Operations b) Mr. Pritesh Shah, Associate Vice President – Finance & Accounts";
  const [a] = extractPeopleFromText(astral);
  assert.equal(a?.name, "Ritesh Patel");
  assert.equal(a?.role, "Associate Vice President – Technical Operations");
  assert.equal(a?.action, "redesignated");
  assert.equal(a?.effective_date, "2026-11-05");

  const cg = "2. Designation of Mr. Rajat Shah and Mr. Rushikesh Kulkarni as Senior Management Personnel The Board of Directors have designated Mr. Rajat Shah, Vice President - Services and Mr. Rushikesh Kulkarni";
  const [c] = extractPeopleFromText(cg);
  assert.equal(c?.name, "Rajat Shah");
  assert.notEqual(c?.action, "resigned");
});

test("rules extractor: a page with no recognisable action yields nothing rather than a resignation", () => {
  assert.deepEqual(extractPeopleFromText("Name of Director: Mr. Arun Kumar Sharma. Designation: Chief Financial Officer."), []);
});
