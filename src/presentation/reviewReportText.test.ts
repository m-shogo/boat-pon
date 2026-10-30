import assert from "node:assert/strict";
import test from "node:test";
import { compactTable, outcomeConclusion } from "./reviewReportText";

test("compact report preserves order/data, caps only text and states the remaining count", () => {
  const rows = Array.from({ length: 13 }, (_, i) => ({ id: i, odds: 1.23456 }));
  const before = JSON.stringify(rows);
  const lines: string[] = [];
  const original = console.log;
  console.log = (text: string) => { lines.push(text); };
  try { compactTable("一覧", rows, [["番号", (r) => r.id], ["オッズ", (r) => r.odds]]); }
  finally { console.log = original; }
  assert.ok(lines.includes("| 9 | 1.235 |"));
  assert.ok(!lines.some((line) => line.startsWith("| 10 |")));
  assert.match(lines.at(-1)!, /残り 3 件/);
  assert.equal(JSON.stringify(rows), before);
});

test("conclusion uses BUY rather than adding overlapping or different decision groups", () => {
  assert.equal(outcomeConclusion([{ decision: "SKIP", settled: 100, hits: 40, roi: 2 }, { decision: "BUY", settled: 12, hits: 1, roi: .9 }]), "BUY 確定 12件 → 的中 1件。実払戻ROI 90.0%。");
});
