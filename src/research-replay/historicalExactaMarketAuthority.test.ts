import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  HISTORICAL_EXACTA_CANONICAL_SOURCE_PREDICATE,
  HISTORICAL_EXACTA_COMPLETE_MARKET_HAVING,
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
      bet_type TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_quality TEXT NOT NULL
    );
  `);
  return db;
}

function insert(db: DatabaseSync, raceId: string, combinations: string[], sourceType: string, sourceQuality: string): void {
  const statement = db.prepare(`
    INSERT INTO historical_alternative_odds(race_id, combination, bet_type, source_type, source_quality)
    VALUES (?, ?, 'exacta', ?, ?)
  `);
  for (const combination of combinations) statement.run(raceId, combination, sourceType, sourceQuality);
}

function qualifyingRaceIds(db: DatabaseSync): string[] {
  return (db.prepare(`
    SELECT DISTINCT h.race_id
    FROM historical_alternative_odds h
    WHERE h.bet_type = 'exacta'
      AND h.${HISTORICAL_EXACTA_CANONICAL_SOURCE_PREDICATE}
      AND ${historicalExactaCompleteMarketPredicate("h.race_id")}
    ORDER BY h.race_id
  `).all() as Array<{ race_id: string }>).map((row) => row.race_id);
}

test("exacta completeness requires the canonical 30-combination official closing market", () => {
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

    assert.deepEqual(qualifyingRaceIds(db), ["valid"]);
  } finally {
    db.close();
  }
});

test("overround grouping uses the same canonical exacta authority", () => {
  const db = setup();
  try {
    const selections = exactaSelections();
    insert(db, "valid", selections, "official_archive", "historical_closing_odds");
    insert(db, "valid", selections.slice(0, 15), "secondary_archive", "historical_closing_odds");
    insert(db, "duplicate-source", selections.slice(0, 15), "official_archive", "historical_closing_odds");
    insert(db, "duplicate-source", selections.slice(0, 15), "secondary_archive", "historical_closing_odds");

    const rows = db.prepare(`
      SELECT race_id
      FROM historical_alternative_odds
      WHERE bet_type = 'exacta'
        AND ${HISTORICAL_EXACTA_CANONICAL_SOURCE_PREDICATE}
      GROUP BY race_id
      HAVING ${HISTORICAL_EXACTA_COMPLETE_MARKET_HAVING}
      ORDER BY race_id
    `).all() as Array<{ race_id: string }>;

    assert.deepEqual(rows.map((row) => row.race_id), ["valid"]);
  } finally {
    db.close();
  }
});
