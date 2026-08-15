import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("BUY learning report stays read-only and does not import operational DB helpers", async () => {
  const source = await readFile("scripts/report-buy-learning-summary.ts", "utf8");
  assert.match(source, /new DatabaseSync\(dbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only = ON/);
  assert.doesNotMatch(source, /from ["']\.\.\/server\/db|INSERT\s+INTO|UPDATE\s+decision_history|DELETE\s+FROM|CREATE\s+TABLE/i);
  assert.doesNotMatch(source, /notify-line|app_settings|automation\/requests|fetch\s*\(/i);
});

test("BUY learning report public output does not select race identity into the summary contract", async () => {
  const source = await readFile("scripts/report-buy-learning-summary.ts", "utf8");
  assert.doesNotMatch(source, /AS\s+(?:raceId|decisionId)|owner-buy-learning-latest\.json.*selection/i);
  assert.match(source, /productionChangeAllowed: false/);
});
