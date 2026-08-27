import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("T-5 market baseline reads selected rows only from the T-5 checkpoint", () => {
  const source = readFileSync("scripts/audit-t5-market-baseline.ts", "utf8");
  const oddsQuery = source.slice(source.indexOf("const odds="), source.indexOf("const results="));

  assert.match(
    oddsQuery,
    /JOIN chosen c ON c\.race_id=o\.race_id AND c\.captured_at=o\.captured_at\s+WHERE o\.checkpoint_label='T-5'\s+GROUP BY o\.race_id,o\.selection/,
  );
});
