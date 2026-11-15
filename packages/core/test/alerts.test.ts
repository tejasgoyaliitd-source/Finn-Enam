import assert from "node:assert/strict";
import { test } from "node:test";
import { describeAlerts, type AlertEvent } from "../src/index";

const base = { symbol: "DIXON", date: "2026-11-14", move_pct: -6.2, z: -3.1, volume_multiple: 4.2 };
const move: AlertEvent = { ...base, kind: "move_sigma" };
const vol: AlertEvent = { ...base, kind: "volume_x" };

test("alert text: a move and a volume spike on one day read as one plain sentence", () => {
  assert.equal(describeAlerts([move, vol]), "Fell 6.2%, 3.1× its usual daily move, on 4.2× normal volume.");
  assert.equal(describeAlerts([move]), "Fell 6.2%, 3.1× its usual daily move.");
  assert.equal(describeAlerts([{ ...vol, move_pct: -1.6, volume_multiple: 8.7 }]), "Traded 8.7× its normal volume, price down 1.6%.");
  assert.equal(describeAlerts([{ ...move, move_pct: 12.94, z: 9.04 }]), "Rose 12.9%, 9× its usual daily move.");
});
