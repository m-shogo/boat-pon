import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_RULE } from "./decision";
import { compareModelVariants } from "./modelComparison";
import type { ModelCandidateInput } from "./model";
import type { RaceResult } from "./types";

function result(id: number, date: string, trifecta: string): RaceResult {
  return {
    raceId: `${date.replaceAll("-", "")}-蒲郡-${String(id).padStart(2, "0")}`,
    date,
    venue: "蒲郡",
    raceNo: id,
    trifecta,
    payoutYen: 1500,
    popularity: 2,
    returned: false,
    source: "test",
    fetchedAt: date + "T00:00:00+09:00",
  };
}

test("複数モデル条件をウォークフォワードで比較する", () => {
  const results: RaceResult[] = [
    result(1, "2026-01-01", "1-2-3"),
    result(2, "2026-01-02", "1-2-3"),
    result(3, "2026-01-03", "2-1-3"),
    result(4, "2026-01-04", "1-2-3"),
  ];
  const programs: ModelCandidateInput[] = [
    { date: "2026-01-04", venue: "蒲郡", raceNo: 4, closeAt: "12:00" },
  ];
  const rows = compareModelVariants({
    results,
    programs,
    settings: { ...DEFAULT_RULE, minSampleSize: 1 },
    oddsByRaceId: new Map([["20260104-蒲郡-04", 20]]),
  });
  assert.equal(rows.length, 4);
  assert.ok(rows[0].variant.id);
});
