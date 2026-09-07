import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";

if (!existsSync(DB_PATH)) {
  console.error("[search-roi-patterns] database not found");
  process.exit(1);
}

const verifiedDbPath = assertCanonicalSingleLinkRegularFile(DB_PATH, "roi-pattern-search primary database identity mismatch");
const db = new DatabaseSync(verifiedDbPath, { readOnly: true });
db.exec("PRAGMA query_only = ON;");
db.exec("PRAGMA busy_timeout = 5000;");

try {
  const integrity = db.prepare(`
WITH relevant_hits AS (
  SELECT DISTINCT dh.race_id, dh.bet_type, dh.selection
  FROM decision_history dh
  WHERE dh.run_kind = 'historical-backfill'
    AND dh.decision = 'BUY'
    AND dh.current_odds IS NOT NULL
    AND dh.result IS NOT NULL
    AND dh.result != ''
    AND dh.returned = 0
    AND dh.selection = dh.result
), invalid AS (
  SELECT h.race_id, h.bet_type, h.selection
  FROM relevant_hits h
  WHERE (
    SELECT COUNT(*)
    FROM race_payouts rp
    WHERE rp.race_id = h.race_id
      AND rp.bet_type = h.bet_type
      AND rp.combination = h.selection
  ) != 1
  OR (
    SELECT COUNT(*)
    FROM race_payouts rp
    WHERE rp.race_id = h.race_id
      AND rp.bet_type = h.bet_type
      AND rp.combination = h.selection
      AND rp.returned = 0
      AND rp.payout_yen > 0
  ) != 1
)
SELECT COUNT(*) AS n FROM invalid
`).get() as { n: number };

  if ((integrity.n ?? 0) > 0) {
    console.error(`[search-roi-patterns] FAIL CLOSED: ${integrity.n} winning ticket key(s) do not have exactly one positive non-refund official settlement`);
    process.exit(2);
  }
} finally {
  db.close();
}

const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/search-roi-patterns-raw.ts"], {
  stdio: "inherit",
  env: process.env,
});
if (result.error) {
  console.error(`[search-roi-patterns] failed to start raw analyzer: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
