import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { parseKyotei24Results } from "./parser";

const fixturePath = path.join("tests", "fixtures", "kyotei24-results-2026-05-21.html");
const html = readFileSync(fixturePath, "utf8");

test("kyotei24結果ページから複数会場のレース結果をパースする", () => {
  const results = parseKyotei24Results(html, "2026-05-21", "2026-05-21T16:24:00+09:00");
  assert.ok(results.length > 0, "結果が1件以上パースされる");
  const venues = new Set(results.map((row) => row.venue));
  assert.ok(venues.size >= 2, "複数会場分が含まれる");
});

test("各結果のraceIdはYYYYMMDD-会場-Rの形式になる", () => {
  const results = parseKyotei24Results(html, "2026-05-21", "2026-05-21T16:24:00+09:00");
  for (const row of results) {
    assert.match(row.raceId, /^20260521-.+-\d{2}$/);
    assert.equal(row.date, "2026-05-21");
    assert.equal(row.source, "kyotei24");
  }
});

test("3連単フィールドは1-6のみで構成された3桁ハイフン区切り", () => {
  const results = parseKyotei24Results(html, "2026-05-21", "2026-05-21T16:24:00+09:00");
  for (const row of results) {
    if (row.trifecta == null) continue;
    assert.match(row.trifecta, /^[1-6]-[1-6]-[1-6]$/);
  }
});

test("払戻と人気は0より大きい数値、未取得はnull", () => {
  const results = parseKyotei24Results(html, "2026-05-21", "2026-05-21T16:24:00+09:00");
  for (const row of results) {
    if (row.payoutYen != null) assert.ok(row.payoutYen > 0);
    if (row.popularity != null) assert.ok(row.popularity > 0);
  }
});

test("会場ごとに最大12レースまで（実態より緩い上限）", () => {
  const results = parseKyotei24Results(html, "2026-05-21", "2026-05-21T16:24:00+09:00");
  const byVenue = new Map<string, number>();
  for (const row of results) byVenue.set(row.venue, (byVenue.get(row.venue) ?? 0) + 1);
  for (const [venue, count] of byVenue) {
    assert.ok(count <= 12, `${venue} の件数 ${count} が12を超えない`);
  }
});
