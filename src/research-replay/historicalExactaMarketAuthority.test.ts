import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  HISTORICAL_EXACTA_COMPLETE_MARKET_HAVING,
  historicalExactaCanonicalSourcePredicate,
  historicalExactaCompleteMarketPredicate,
} from "./historicalExactaMarketAuthority";

function exactaSelections(): string[] {
  const values: string[] = [];
  for (let first = 1; first <= 6; first += 1) {
    for (let second = 1; second <= 6; second += 1) {
      if (first !== second) values.push(`${first}-${second}`);
    }
  }
  return values;
}

function setup(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE historical_alternative_odds (
      race_id TEXT NOT NULL,
      combination TEXT NOT NULL,
      odds REAL NOT NULL,
      bet_type TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_quality TEXT NOT NULL,
      is_backfill INTEGER NOT NULL,
      fetch_status TEXT NOT NULL
    );
  `);
  return db;
}

function insert(
  db: DatabaseSync,
  raceId: string,
  combinations: string[],
  sourceType: string,
  sourceQuality: string,
  oddsForCombination: (combination: string, index: number) => number = (_combination, index) => 2 + index,
  isBackfill = 1,
  fetchStatus = "success",
): void {
  const statement = db.prepare(`
    INSERT INTO historical_alternative_odds(
      race_id, combination, odds, bet_type, source_type, source_quality, is_backfill, fetch_status
    ) VALUES (?, ?, ?, 'exacta', ?, ?, ?, ?)
  `);
  combinations.forEach((combination, index) => {
    statement.run(
      raceId,
      combination,
      oddsForCombination(combination, index),
      sourceType,
      sourceQuality,
      isBackfill,
      fetchStatus,
    );
  });
}

function qualifyingRaceIds(db: DatabaseSync): string[] {
  return (db.prepare(`
    SELECT DISTINCT h.race_id
    FROM historical_alternative_odds h
    WHERE h.bet_type = 'exacta'
      AND ${historicalExactaCanonicalSourcePredicate("h")}
      AND ${historicalExactaCompleteMarketPredicate("h.race_id")}
    ORDER BY h.race_id
  `).all() as Array<{ race_id: string }>).map((row) => row.race_id);
}

test("exacta completeness requires canonical successful backfill evidence", () => {
  const db = setup();
  try {
    const selections = exactaSelections();
    insert(db, "valid", selections, "official_archive", "historical_closing_odds");
    insert(db, "valid", selections.slice(0, 15), "secondary_archive", "historical_closing_odds");
    insert(db, "duplicate-source", selections.slice(0, 15), "official_archive", "historical_closing_odds");
    insert(db, "duplicate-source", selections.slice(0, 15), "secondary_archive", "historical_closing_odds");
    insert(db, "mixed-source", selections.slice(0, 15), "official_archive", "historical_closing_odds");
    insert(db, "mixed-source", selections.slice(15), "secondary_archive", "historical_closing_odds");
    insert(db, "secondary-only", selections, "secondary_archive", "historical_closing_odds");
    insert(db, "malformed", [...selections.slice(0, 29), "7-1"], "official_archive", "historical_closing_odds");
    insert(
      db,
      "invalid-odds",
      selections,
      "official_archive",
      "historical_closing_odds",
      (_combination, index) => index === 0 ? 1.0 : 2 + index,
    );
    insert(db, "failed-fetch", selections, "official_archive", "historical_closing_odds", undefined, 1, "failed");
    insert(db, "not-backfill", selections, "official_archive", "historical_closing_odds", undefined, 0, "success");

    assert.deepEqual(qualifyingRaceIds(db), ["valid"]);
  } finally {
    db.close();
  }
});

test("overround grouping ignores noncanonical or unsuccessful source rows", () => {
  const db = setup();
  try {
    const selections = exactaSelections();
    insert(db, "valid", selections, "official_archive", "historical_closing_odds");
    insert(db, "valid", selections.slice(0, 15), "secondary_archive", "historical_closing_odds");
    insert(db, "duplicate-source", selections.slice(0, 15), "official_archive", "historical_closing_odds");
    insert(db, "duplicate-source", selections.slice(0, 15), "secondary_archive", "historical_closing_odds");
    insert(
      db,
      "invalid-odds",
      selections,
      "official_archive",
      "historical_closing_odds",
      (_combination, index) => index === 29 ? 0.5 : 2 + index,
    );
    insert(db, "failed-fetch", selections, "official_archive", "historical_closing_odds", undefined, 1, "failed");

    const rows = db.prepare(`
      SELECT race_id
      FROM historical_alternative_odds
      WHERE bet_type = 'exacta'
        AND ${historicalExactaCanonicalSourcePredicate()}
      GROUP BY race_id
      HAVING ${HISTORICAL_EXACTA_COMPLETE_MARKET_HAVING}
      ORDER BY race_id
    `).all() as Array<{ race_id: string }>;

    assert.deepEqual(rows.map((row) => row.race_id), ["valid"]);
  } finally {
    db.close();
  }
});