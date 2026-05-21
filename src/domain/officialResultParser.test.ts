import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { parseOfficialResultsText } from "./officialResultParser";

const buf = readFileSync(path.join("tests", "fixtures", "K260520.TXT"));
const text = new TextDecoder("shift_jis").decode(buf);

test("公式競走成績テキストから複数会場のレース結果をパースする", () => {
  const results = parseOfficialResultsText(text, {
    date: "2026-05-20",
    fetchedAt: "2026-05-21T18:00:00+09:00",
  });
  assert.ok(results.length >= 100, `100件以上ではなく ${results.length} 件`);
  const venues = new Set(results.map((row) => row.venue));
  assert.ok(venues.size >= 3, "3会場以上");
});

test("芦屋1Rの3連単・払戻・人気が抽出できる", () => {
  const results = parseOfficialResultsText(text, {
    date: "2026-05-20",
    fetchedAt: "2026-05-21T18:00:00+09:00",
  });
  const ashiya1 = results.find((row) => row.venue === "芦屋" && row.raceNo === 1);
  assert.ok(ashiya1, "芦屋1Rが見つかる");
  assert.equal(ashiya1!.trifecta, "4-5-1");
  assert.equal(ashiya1!.payoutYen, 30810);
  assert.equal(ashiya1!.popularity, 68);
});

test("raceIdとdateとsourceが整っている", () => {
  const results = parseOfficialResultsText(text, {
    date: "2026-05-20",
    fetchedAt: "2026-05-21T18:00:00+09:00",
  });
  for (const row of results) {
    assert.match(row.raceId, /^20260520-.+-\d{2}$/);
    assert.equal(row.date, "2026-05-20");
    assert.equal(row.source, "official");
  }
});
