import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const DB_PATH = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
const BET_TYPES = ["trifecta", "trio", "exacta", "quinella", "wide"] as const;

if (!existsSync(DB_PATH)) {
  throw new Error(`PROMISING_BET_DB_NOT_FOUND ${DB_PATH}`);
}

const dbPath = assertCanonicalSingleLinkRegularFile(DB_PATH, "RESEARCH_DB_IDENTITY_INVALID");
const db = new DatabaseSync(dbPath, { readOnly: true });
db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout = 5000;");

type RawRow = { race_id: string };
type PayoutRow = {
  race_id: string;
  bet_type: string;
  combination: string;
  payout_yen: number | null;
  returned: number;
};

const rows = db.prepare(`
  SELECT race_id
  FROM decision_history
  WHERE decision='BUY' AND run_kind='historical-backfill'
    AND result IS NOT NULL AND result != ''
`).all() as RawRow[];

const seenSettlementKeys = new Set<string>();
const settledRaceByType = new Map<string, Set<string>>(BET_TYPES.map(bt => [bt, new Set<string>()]));

for (const p of db.prepare(`
  SELECT race_id, bet_type, combination, payout_yen, returned
  FROM race_payouts
  WHERE bet_type IN ('exacta','quinella','wide','trifecta','trio')
`).all() as PayoutRow[]) {
  const key = `${p.race_id}|${p.bet_type}|${p.combination}`;
  if (seenSettlementKeys.has(key)) {
    throw new Error(`PROMISING_BET_PAYOUT_DUPLICATE_COMBINATION ${key}`);
  }
  seenSettlementKeys.add(key);

  const isValidSettlement = p.returned === 1 || (p.payout_yen != null && p.payout_yen > 0);
  if (!isValidSettlement) {
    throw new Error(`PROMISING_BET_PAYOUT_INVALID_LINE ${key}`);
  }
  settledRaceByType.get(p.bet_type)?.add(p.race_id);
}

assertPayoutCompleteness();
db.close();

function assertPayoutCompleteness(): void {
  const raceIds = new Set(rows.map(row => row.race_id));
  if (raceIds.size <= 0) throw new Error("PROMISING_BET_BUY_POPULATION_EMPTY");

  const coverage = Object.fromEntries(BET_TYPES.map(bt => {
    const settled = [...raceIds].filter(raceId => settledRaceByType.get(bt)?.has(raceId)).length;
    return [bt, { total: raceIds.size, settled }];
  }));
  const invalid = BET_TYPES.some(bt => coverage[bt].settled !== coverage[bt].total);
  if (invalid) {
    throw new Error(`PROMISING_BET_PAYOUT_COVERAGE_INCOMPLETE ${JSON.stringify(coverage)}`);
  }
}

await import("./analyze-promising-bet-type-strategies-raw.ts");
