import { XMLParser } from "fast-xml-parser";
import type { Basis } from "@finn/shared";
import { toCrore, type Column, type Field, type Statement } from "./statement";

/**
 * NSE/BSE Ind AS results XBRL ("Integrated Filing – Financials"). Monetary facts are in
 * rupees (unitRef → iso4217:INR) regardless of the rounding level printed in the PDF, so
 * everything is divided by 1e7 to get crore.
 *
 * Tags are matched on local name (namespace prefixes differ between filings and years),
 * with a list of accepted names per field. Facts with dimensions (segment data) are ignored:
 * only entity-level totals are used.
 */
const TAGS: Record<Field, string[]> = {
  revenue: ["RevenueFromOperations", "InterestEarned"],
  other_income: ["OtherIncome"],
  finance_costs: ["FinanceCosts"],
  depreciation: ["DepreciationDepletionAndAmortisationExpense", "DepreciationAndAmortisationExpense"],
  share_of_associates_in_pbt: [
    "ShareOfProfitLossOfAssociatesAndJointVenturesAccountedForUsingEquityMethod",
    "ShareOfProfitLossOfAssociatesAndJointVentures",
  ],
  pbt_before_exceptional: ["ProfitBeforeExceptionalItemsAndTax"],
  exceptional_items: ["ExceptionalItemsBeforeTax", "ExceptionalItems"],
  pbt: ["ProfitBeforeTax", "ProfitLossFromOrdinaryActivitiesBeforeTax"],
  tax: ["TaxExpense"],
  share_of_associates_after_tax: ["ShareOfProfitLossOfAssociatesAndJointVenturesAfterTax"],
  pat: ["ProfitLossForPeriod", "NetProfitLossForThePeriodBeforeMinorityInterest", "NetProfitLossFromOrdinaryActivitiesAfterTax"],
  pat_owners: ["ProfitOrLossAttributableToOwnersOfParent", "NetProfitLossForThePeriod"],
  interest_expended: ["InterestExpended"],
  ppop: ["OperatingProfitBeforeProvisionAndContingencies"],
  provisions: ["ProvisionsOtherThanTaxAndContingencies"],
  operating_cash_flow: ["CashFlowsFromUsedInOperatingActivities", "NetCashFlowsFromUsedInOperatingActivities"],
};

export class XbrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XbrlError";
  }
}

interface Fact {
  name: string;
  context: string;
  unit: string | null;
  text: string;
}

const parser = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});

const arr = <T>(x: T | T[] | undefined): T[] => (x === undefined ? [] : Array.isArray(x) ? x : [x]);
const text = (node: unknown): string =>
  typeof node === "string" ? node : node && typeof node === "object" ? String((node as Record<string, unknown>)["#text"] ?? "") : "";

/** Parse an XBRL instance into one statement. Throws XbrlError if it isn't usable. */
export function parseResultsXbrl(xml: string): Statement {
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xml) as Record<string, unknown>;
  } catch (err) {
    throw new XbrlError(`not well-formed XML: ${String(err).slice(0, 120)}`);
  }
  const root = (doc.xbrl ?? doc.XBRL) as Record<string, unknown> | undefined;
  if (!root || typeof root !== "object") throw new XbrlError("no <xbrl> root element");

  // Contexts without dimensions → period.
  const periods = new Map<string, { start: string; end: string }>();
  for (const c of arr(root.context as Record<string, unknown>[])) {
    const id = String(c["@_id"] ?? "");
    const entity = c.entity as Record<string, unknown> | undefined;
    const dimensional = Boolean(entity?.segment) || Boolean(c.scenario);
    const p = c.period as Record<string, unknown> | undefined;
    const start = text(p?.startDate);
    const end = text(p?.endDate);
    if (id && !dimensional && start && end) periods.set(id, { start, end });
  }
  const inrUnits = new Set(
    arr(root.unit as Record<string, unknown>[])
      .filter((u) => /INR$/i.test(text(u.measure)))
      .map((u) => String(u["@_id"])),
  );

  const facts: Fact[] = [];
  for (const [name, node] of Object.entries(root)) {
    if (name.startsWith("@_") || ["context", "unit", "schemaRef"].includes(name)) continue;
    for (const f of arr(node as Record<string, unknown> | Record<string, unknown>[])) {
      if (!f || typeof f !== "object") continue;
      const context = String((f as Record<string, unknown>)["@_contextRef"] ?? "");
      if (!context) continue;
      facts.push({ name, context, unit: ((f as Record<string, unknown>)["@_unitRef"] as string) ?? null, text: text(f) });
    }
  }

  const basisFact = facts.find((f) => /^NatureOfReportStandaloneConsolidated$/i.test(f.name))?.text ?? "";
  const basis: Basis | null = /consolidated/i.test(basisFact) ? "consolidated" : /standalone/i.test(basisFact) ? "standalone" : null;
  if (!basis) throw new XbrlError("NatureOfReportStandaloneConsolidated missing: cannot tell consolidated from standalone");

  const columns = new Map<string, Column>();
  for (const [field, names] of Object.entries(TAGS) as [Field, string[]][]) {
    const lower = names.map((n) => n.toLowerCase());
    for (const f of facts) {
      const rank = lower.indexOf(f.name.toLowerCase());
      if (rank < 0) continue;
      const period = periods.get(f.context);
      if (!period) continue; // dimensional or instant context
      if (f.unit && !inrUnits.has(f.unit)) continue;
      const n = Number(f.text);
      if (!Number.isFinite(n)) throw new XbrlError(`${f.name} in ${f.context} is not a number: "${f.text.slice(0, 30)}"`);
      const key = `${period.start}|${period.end}`;
      const col = columns.get(key) ?? { start: period.start, end: period.end, values: {}, page: null };
      // Prefer the first-listed tag name when several are present for the same field.
      const prev = (col as Column & { _rank?: Partial<Record<Field, number>> })._rank ?? {};
      if (col.values[field] === undefined || (prev[field] ?? 99) > rank) {
        col.values[field] = toCrore(n, "rupees");
        prev[field] = rank;
        (col as Column & { _rank?: Partial<Record<Field, number>> })._rank = prev;
      }
      columns.set(key, col);
    }
  }
  const out = [...columns.values()].map(({ start, end, values, page }) => ({ start, end, values, page }));
  if (!out.some((c) => c.values.revenue != null && c.values.pat != null)) {
    throw new XbrlError("no period has both revenue and profit: unrecognised taxonomy or empty filing");
  }
  return { basis, columns: out };
}
