import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("historical forward reads selected rows only from the T-5 checkpoint", () => {
  const source = readFileSync("scripts/audit-t5-historical-market-forward.ts", "utf8");
  const oddsQuery = source.slice(source.indexOf("function loadLatestCompleteCaptures"), source.indexOf("function loadPrograms"));

  assert.match(
    oddsQuery,
    /JOIN chosen ON chosen\.race_id = source\.race_id AND chosen\.captured_at = source\.captured_at\s+WHERE source\.checkpoint_label = 'T-5'\s+GROUP BY source\.race_id, source\.selection/,
  );
});
