import assert from "node:assert/strict";
import test from "node:test";
import { assertGenerateHistoryWriteAllowed, inferDecisionRunKind, isPaperLiveDecision } from "./liveRunKind";

test("inferDecisionRunKindはpaper-live/historical-backfill/manual-test/sampleを区別する", () => {
  assert.equal(inferDecisionRunKind({ date: "2026-05-27", source: "history-model" }), "paper-live");
  assert.equal(inferDecisionRunKind({ date: "2025-12-31", source: "history-model" }), "historical-backfill");
  assert.equal(inferDecisionRunKind({ date: "2026-05-27", source: "manual" }), "manual-test");
  assert.equal(inferDecisionRunKind({ date: "2026-05-27", source: "sample" }), "sample");
});

test("generate:historyは2026年以降の非dry-run書き込みを明示許可なしで止める", () => {
  assert.throws(
    () => assertGenerateHistoryWriteAllowed({ to: "2026-01-01", dryRun: false, allowLiveWrite: false }),
    /live write blocked/,
  );
  assert.doesNotThrow(() => assertGenerateHistoryWriteAllowed({ to: "2026-01-01", dryRun: true, allowLiveWrite: false }));
  assert.doesNotThrow(() => assertGenerateHistoryWriteAllowed({ to: "2025-12-31", dryRun: false, allowLiveWrite: false }));
});

test("2026年以降でもhistorical-backfillはpaper-live集計に混ざらない", () => {
  const modelVersion = "boatpon-v3-alpha15";
  assert.equal(isPaperLiveDecision({ date: "2026-06-01", modelVersion, runKind: "paper-live" }, modelVersion), true);
  assert.equal(isPaperLiveDecision({ date: "2026-06-01", modelVersion, runKind: "historical-backfill" }, modelVersion), false);
  assert.equal(isPaperLiveDecision({ date: "2026-06-01", modelVersion, runKind: "manual-test" }, modelVersion), false);
  assert.equal(isPaperLiveDecision({ date: "2026-06-01", modelVersion: "old-model", runKind: "paper-live" }, modelVersion), false);
});
