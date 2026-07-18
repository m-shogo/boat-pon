import assert from "node:assert/strict";
import test from "node:test";
import { eventContextFlags } from "./eventContext";

test("競走場周年とBTS周年を混同しない", () => {
  assert.ok(eventContextFlags("開設72周年記念 びわこ大賞", "2024-09-15").includes("venue_anniversary"));
  const bts = eventContextFlags("BTS井原開設8周年記念競走", "2024-09-15");
  assert.ok(bts.includes("satellite_anniversary"));
  assert.ok(!bts.includes("venue_anniversary"));
});

test("開催タイトルと暦を別々に分類する", () => {
  const flags = eventContextFlags("ルーキーシリーズ 新春杯", "2025-01-04");
  assert.ok(flags.includes("rookie"));
  assert.ok(flags.includes("new_year_title"));
  assert.ok(flags.includes("new_year_calendar"));
  assert.ok(flags.includes("weekend"));
});
