import { z } from "zod";
import type { IstDateTime } from "@finn/shared";

/**
 * Management change extractor.
 *
 * SEBI LODR Regulations (Reg. 30 read with Part A of Schedule III) mandate that companies
 * disclose:
 *   1. Reason for change viz. appointment, re-appointment, resignation, removal, death or otherwise;
 *   2. Date of appointment/re-appointment/cessation & term of appointment;
 *   3. Brief profile (in case of appointment);
 *   4. Disclosure of relationships between directors.
 *
 * For appointments: extracts incoming person name, role, previous roles, effective date.
 * For resignations: extracts stated reason and tenure.
 * Also computes trailing 12-month senior exit count: "Second senior exit this year".
 */

export const PeopleAction = z.enum(["appointed", "resigned", "retired", "removed", "redesignated", "ceased"]);
export type PeopleAction = z.infer<typeof PeopleAction>;

export const ExtractedPerson = z.strictObject({
  name: z.string().min(1),
  role: z.string().min(1),
  action: PeopleAction,
  effective_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  prior_roles: z.array(z.string().min(1)),
  tenure_months: z.number().int().min(0).nullable(),
  stated_reason: z.string().min(1).nullable(),
  source_page: z.number().int().positive().nullable(),
});
export type ExtractedPerson = z.infer<typeof ExtractedPerson>;

export const PeopleExtractionSchema = z.strictObject({
  events: z.array(ExtractedPerson),
});
export type PeopleExtraction = z.infer<typeof PeopleExtractionSchema>;

export const PEOPLE_PROMPT_VERSION = "people-extract-v1";
export const PEOPLE_SYSTEM_PROMPT = [
  "You read an Indian listed company's SEBI LODR Regulation 30 disclosure regarding a change in directorate, management or Key Managerial Personnel (KMP).",
  "Extract structured executive change records matching the schema:",
  "  - name: full name of the executive/director (exclude honorifics like Mr./Ms./Dr.)",
  "  - role: designation (e.g. Chief Financial Officer, Managing Director, Company Secretary)",
  "  - action: appointed, resigned, retired, removed, redesignated, or ceased",
  "  - effective_date: YYYY-MM-DD format (from 'effective from', 'w.e.f.', or stated date)",
  "  - prior_roles: for appointments, extract previous roles and companies from the brief profile as an array of strings",
  "  - tenure_months: for resignations/cessations, tenure in months if mentioned in the letter/disclosure (or null)",
  "  - stated_reason: for resignations, the officially stated reason verbatim (e.g. 'personal reasons', 'to pursue opportunities outside', 'superannuation')",
  "  - source_page: page number where the profile/change is disclosed",
  "Return JSON matching the schema.",
].join("\n");

const ORDINAL_WORDS: Record<number, string> = {
  1: "First",
  2: "Second",
  3: "Third",
  4: "Fourth",
  5: "Fifth",
  6: "Sixth",
  7: "Seventh",
  8: "Eighth",
  9: "Ninth",
  10: "Tenth",
};

export const SENIOR_ROLES = /\b(?:chief financial officer|cfo|chief executive officer|ceo|managing director|md\b|company secretary|cs\b|executive director|whole[- ]time director|president|chief operating officer|coo)\b/i;

/**
 * Counts senior leadership exits at a company in trailing 12 months.
 * Formats note: "First senior exit this year", "Second senior exit this year", etc.
 */
export function countSeniorExits(
  events: Array<{
    role: string;
    action: PeopleAction | string;
    effective_date?: string | null;
    filed_at?: string | null;
  }>,
  asOf: Date | IstDateTime = new Date(),
): { count: number; note: string } {
  const asOfDate = new Date(asOf);
  const twelveMonthsAgo = new Date(asOfDate.getTime() - 365 * 24 * 3600 * 1000);

  const exits = events.filter((e) => {
    const isExit = e.action === "resigned" || e.action === "removed" || e.action === "ceased";
    if (!isExit) return false;
    if (!SENIOR_ROLES.test(e.role)) return false;

    const dateStr = e.effective_date ?? e.filed_at;
    if (!dateStr) return true;
    const d = new Date(dateStr);
    return isNaN(d.getTime()) || (d >= twelveMonthsAgo && d <= asOfDate);
  });

  const count = exits.length;
  if (count === 0) return { count: 0, note: "No senior exits this year" };
  const word = ORDINAL_WORDS[count] ?? `${count}th`;
  return { count, note: `${word} senior exit this year` };
}

/**
 * Deterministic parser for standard SEBI Regulation 30 disclosure annexures.
 */
export function extractPeopleFromText(rawText: string, page = 1): ExtractedPerson[] {
  const out: ExtractedPerson[] = [];
  // SEBI's annexure template lists every possible action ("viz. appointment, re-appointment,
  // resignation, removal, death or otherwise"); drop that boilerplate before reading the action.
  const text = rawText
    .replace(/viz\.?[\s,]*appointment[\s\S]{0,80}?otherwise/gi, " ")
    .replace(/Date of appointment\s*\/[\s\S]{0,60}?cessation/gi, "Date of change");

  // Names are matched case-sensitively: an /i flag would let "and Mr" pass for a surname.
  const NAME = String.raw`([A-Z][a-zA-Z]*\.?(?:[^\S\r\n]+[A-Z][a-zA-Z]*\.?){1,3})`;
  const nameMatch =
    new RegExp(String.raw`(?:[Nn]ame of (?:[Dd]irector|KMP|SMP|[Kk]ey [Mm]anagerial [Pp]ersonnel|[Pp]erson|the [Dd]irector)|\b[Nn]ame)\s*[:\-]?\s*(?:Mr\.?|Ms\.?|Mrs\.?|Shri|Smt\.?|Dr\.?)?\s*` + NAME).exec(text) ??
    new RegExp(String.raw`(?:Mr\.|Ms\.|Mrs\.|Shri|Smt\.)[^\S\r\n]+` + NAME).exec(text);
  if (!nameMatch) return [];
  const rawName = nameMatch[1]!.replace(/\b(?:Mr|Ms|Mrs|Shri|Smt|Dr)\.?\s+/g, "").replace(/\s+(?:and|DIN)$/i, "").trim();

  // The designation written right after the name ("Mr. X, Associate Vice President – Finance"),
  // else the designation field, else any senior title on the page.
  const after = text.slice(nameMatch.index + nameMatch[0].length);
  const inline = /^\s*(?:\(DIN[^)]*\))?\s*,\s*([A-Z][^,\n;]{3,80}?)(?=\s+[a-z]\)\s|\s*[\n;]|\s+and\s|\s+as\s|\s*$)/.exec(after);
  const roleMatch =
    /(?:Designation|Role|Position|in the capacity of|appointed as|resignation as|designated as)\s*[:\-]?\s*(Chief Financial Officer|Chief Executive Officer|Chief Operating Officer|Managing Director|Company Secretary|Whole[- ]time Director|Executive Director|Independent Director|Non[- ]Executive Director|Additional Director|Senior Management Personnel|CFO|CEO|MD|CS)/i.exec(text) ??
    SENIOR_ROLES.exec(text);
  const rawRole = inline?.[1]?.trim() ?? (roleMatch ? (roleMatch[1] ?? roleMatch[0]).trim() : null);
  if (!rawRole) return [];

  // The action: from the "Reason for change" field when present, else from the whole page.
  // Never a default: a filing we can't read is skipped, not called a resignation.
  const reasonField = /Reason for change[^A-Za-z]{0,10}([^\n]{0,160})/i.exec(text)?.[1] ?? "";
  const actionOf = (t: string): PeopleAction | null =>
    /\bre-?designat|\bdesignated as\b/i.test(t) && !/\bappoint/i.test(t) ? "redesignated"
      : /\bresign|\bstep(?:ped|s)? down\b/i.test(t) ? "resigned"
        : /\bretire/i.test(t) ? "retired"
          : /\bremov/i.test(t) ? "removed"
            : /\bcessation\b|\bceased?\b|completion of (?:his|her|the) (?:\w+ )?term/i.test(t) ? "ceased"
              : /\bappoint|\bdesignated\b/i.test(t) ? "appointed"
                : null;
  const action = actionOf(reasonField) ?? actionOf(text);
  if (!action) return [];
  const isResignation = action === "resigned";

  // Date parsing
  let effective_date: string | null = null;
  const dateM =
    /(?:w\.e\.f\.|effective (?:from|date)|with effect from|Date of (?:appointment|cessation))[^.\n;]{0,60}?\b([0-9]{1,2}[\/\-\.][0-9]{1,2}[\/\-\.][0-9]{2,4}|[A-Za-z]+ \d{1,2},? \d{4}|\d{1,2} [A-Za-z]+,? \d{4})/i.exec(text);
  if (dateM) {
    const parsed = new Date(dateM[1]!.replace(/,/g, ""));
    if (!isNaN(parsed.getTime())) {
      const y = parsed.getFullYear();
      const m = String(parsed.getMonth() + 1).padStart(2, "0");
      const d = String(parsed.getDate()).padStart(2, "0");
      effective_date = `${y}-${m}-${d}`;
    }
  }

  // Reason for change
  let stated_reason: string | null = null;
  const reasonM = /(?:Reason for change[^:\n]*[:\-])\s*([^\n.;]{4,200})/i.exec(text);
  if (reasonM) {
    stated_reason = reasonM[1]!.trim();
  } else if (isResignation) {
    const personal = /personal reasons|pursue (?:other )?opportunities|health reasons|superannuation|tenure completion/i.exec(text);
    if (personal) stated_reason = personal[0].trim();
  }

  // Prior roles (Brief profile)
  const prior_roles: string[] = [];
  const profileM = /(?:Brief profile[^:\n]*[:\-])\s*([\s\S]{20,800}?)(?=(?:Disclosure of relationships|Date of|Reason for|$))/i.exec(text);
  if (profileM) {
    const lines = profileM[1]!
      .split(/(?:\. |\n|\r|; )/)
      .map((s) => s.trim())
      .filter((s) => s.length > 5 && /\b(?:worked|served|associated|experience|CFO|Director|Vice President|Head|VP)\b/i.test(s));
    prior_roles.push(...lines.slice(0, 5));
  }

  // Tenure
  let tenure_months: number | null = null;
  const tenureM =
    /(?:tenure|associated (?:with the company )?for|served for)[^.\n;]{0,40}?\b(\d+)\s+(years?|months?)/i.exec(text);
  if (tenureM) {
    const num = parseInt(tenureM[1]!, 10);
    tenure_months = tenureM[2]!.startsWith("year") ? num * 12 : num;
  }

  out.push({
    name: rawName,
    role: rawRole,
    action,
    effective_date,
    prior_roles,
    tenure_months,
    stated_reason,
    source_page: page,
  });

  return out;
}
