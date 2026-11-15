import assert from "node:assert/strict";
import { test } from "node:test";
import { parseNseEquityList } from "../src/index";

test("NSE equity list: quoted names, banks by name, bad rows skipped", () => {
  const csv = [
    "SYMBOL,NAME OF COMPANY, SERIES, DATE OF LISTING, PAID UP VALUE, MARKET LOT, ISIN NUMBER, FACE VALUE",
    "CIPLA,Cipla Limited,EQ,08-NOV-1995,2,1,INE059A01026,2",
    'M&M,"Mahindra & Mahindra Limited",EQ,08-NOV-1995,5,1,INE101A01026,5',
    "SBIN,State Bank of India,EQ,01-MAR-1995,1,1,INE062A01020,1",
    "bad symbol!,Nope Ltd,EQ,01-JAN-2000,1,1,INE000000000,1",
    "NOISIN,No Isin Ltd,EQ,01-JAN-2000,1,1,XX123,1",
    "CIPLA,Duplicate,EQ,08-NOV-1995,2,1,INE059A01026,2",
  ].join("\n");
  const rows = parseNseEquityList(csv);
  assert.deepEqual(rows.map((r) => r.symbol), ["CIPLA", "M&M", "SBIN"]);
  assert.equal(rows[1]!.name, "Mahindra & Mahindra Limited");
  assert.equal(rows.find((r) => r.symbol === "SBIN")!.is_bank, true);
  assert.equal(rows[0]!.is_bank, false);
});
