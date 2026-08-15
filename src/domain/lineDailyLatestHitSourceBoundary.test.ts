import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const source = readFileSync(resolve(process.cwd(), "scripts/notify-line.ts"), "utf8");

test("daily LINE latest hit uses only the current logical paper-live BUY and official settled result", () => {
  assert.match(source, /function latestBuyHit\(db: DatabaseSync\)/u);
  assert.match(source, /PARTITION BY dh\.race_id, dh\.bet_type, dh\.selection/u);
  assert.match(source, /ORDER BY dh\.created_at DESC, dh\.id DESC/u);
  assert.match(source, /dh\.model_version = \?/u);
  assert.match(source, /dh\.run_kind = 'paper-live'/u);
  assert.match(source, /dh\.row_num = 1/u);
  assert.match(source, /COALESCE\(rr\.returned, 0\) = 0/u);
  assert.match(source, /rr\.trifecta = dh\.selection/u);
  assert.match(source, /rr\.payout_yen IS NOT NULL/u);
  assert.match(source, /ORDER BY dh\.date DESC, dh\.race_no DESC, dh\.created_at DESC, dh\.id DESC/u);
  assert.match(source, /formatLineDailyLatestHit\(latestHit\)/u);
});
