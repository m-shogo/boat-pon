import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts?: Record<string, string> };

const entries = [
  {
    script: "report:roi-combination-watch",
    path: "scripts/report-roi-combination-watch.ts",
    guard: "ROI_COMBINATION_WATCH_OFFICIAL_PAYOUT_REQUIRED",
  },
  {
    script: "report:roi-watchlist",
    path: "scripts/report-roi-watchlist.ts",
    guard: "ROI_WATCHLIST_OFFICIAL_PAYOUT_REQUIRED",
  },
  {
    script: "report:roi-watchlist-summary",
    path: "scripts/report-roi-watchlist-summary.ts",
    guard: "ROI_WATCHLIST_SUMMARY_OFFICIAL_PAYOUT_REQUIRED",
  },
] as const;

test("quote-based ROI watch chain fails closed from combination source through downstream summaries", () => {
  for (const entry of entries) {
    const source = readFileSync(entry.path, "utf8");
    assert.equal(pkg.scripts?.[entry.script], `tsx ${entry.path}`);
    assert.match(source, new RegExp(entry.guard));
    assert.match(source, /complete canonical official settlement/);
    assert.match(source, /process\.exit\(2\)/);
    assert.doesNotMatch(source, /writeFileSync/);
  }

  const combination = readFileSync(entries[0].path, "utf8");
  assert.doesNotMatch(combination, /DatabaseSync/);
  assert.doesNotMatch(combination, /strong historical pattern/);
  assert.doesNotMatch(combination, /hit \* current_odds/);

  const watchlist = readFileSync(entries[1].path, "utf8");
  assert.doesNotMatch(watchlist, /JSON\.parse\(readFileSync/);
  assert.doesNotMatch(watchlist, /buildCatA/);

  const summary = readFileSync(entries[2].path, "utf8");
  assert.doesNotMatch(summary, /JSON\.parse\(readFileSync/);
  assert.doesNotMatch(summary, /buildSummary/);
});
