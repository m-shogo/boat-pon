import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  HISTORICAL_TRIFECTA_COMPLETE_MARKET_HAVING,
  historicalTrifectaCanonicalSourcePredicate,
  historicalTrifectaCompleteMarketPredicate,
} from "./historicalTrifectaMarketAuthority";

function trifectaSelections(): string[] {
  const values: string[] = [];
  for (let first = 1; first <= 6; first += 1) {
    for (let second = 1; second <= 6; second += 1) {
      for (let third = 1; third <= 6; third += 1) {
        if (first !== second && first !== third && second !== third) values.push(`${first}-${second}-${third}`);
      }
    }
  }
  return values;
}

type RaceIdentity = {
  raceId: string;
  raceDate: string;
  venue: string;
  venueCode: string;
  raceNo: number;
};

const VALID: RaceIdentity = { raceId: "20240101-桐生-01", raceDate: "2024-01-01", venue: "桐生", venueCode: "01", raceNo: 1 };
const DUPLICATE_SOURCE: RaceIdentity = { raceId: "20240102-戸田-02", raceDate: "2024-01-02", venue: "戸田", venueCode: "02", raceNo: 2 };
const SECONDARY_ONLY: RaceIdentity = { raceId: "20240103-江戸川-03", raceDate: "2024-01-03", venue: "江戸川", venueCode: "03", raceNo: 3 };
const MALFORMED: RaceIdentity = { raceId: "20240104-平和島-04", raceDate: "2024-01-04", venue: "平和島", venueCode: "04", raceNo: 4 };
const INVALID_ODDS: RaceIdentity = { raceId: "20240105-多摩川-05", raceDate: "2024-01-05", venue: "多摩川", venueCode: "05", raceNo: 5 };

function setup(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE historical_alternative_odds (
      race_id TEXT NOT NULL,
      race_date TEXT NOT NULL,
      venue TEXT NOT NULL,
      venue_code TEXT NOT NULL,
      race_no INTEGER NOT NULL,
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
  identity: RaceIdentity,
  combinations: string[],
  sourceType: string,
  sourceQuality: string,
  oddsForCombination: (combination: string, index: number) => number = (_combination, index) => 2 + index,
  isBackfill = 1,
  fetchStatus = "success",
): void {
  const statement = db.prepare(`
    INSERT INTO historical_alternative_odds(
      race_id, race_date, venue, venue_code, race_no,
      combination, odds, bet_type, source_type, source_quality, is_backfill, fetch_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'trifecta', ?, ?, ?, ?)
  `);
  combinations.forEach((combination, index) => {
    statement.run(
      identity.raceId,
      identity.raceDate,
      identity.venue,
      identity.venueCode,
      identity.raceNo,
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
    WHERE h.bet_type = 'trifecta'
      AND ${historicalTrifectaCanonicalSourcePredicate("h")}
      AND ${historicalTrifectaCompleteMarketPredicate("h.race_id")}
    ORDER BY h.race_id
  `).all() as Array<{ race_id: string }>).map((row) => row.race_id);
}

test("trifecta completeness requires canonical successful backfill evidence with bound race identity", () => {
  const db = setup();
  try {
    const selections = trifectaSelections();
    insert(db, VALID, selections, "official_archive", "historical_closing_odds");
    insert(db, VALID, selections.slice(0, 60), "secondary_archive", "historical_closing_odds");
    insert(db, DUPLICATE_SOURCE, selections.slice(0, 60), "official_archive", "historical_closing_odds");
    insert(db, DUPLICATE_SOURCE, selections.slice(60), "secondary_archive", "historical_closing_odds");
    insert(db, SECONDARY_ONLY, selections, "secondary_archive", "historical_closing_odds");
    insert(db, MALFORMED, [...selections.slice(0, 119), "7-1-2"], "official_archive", "historical_closing_odds");
    insert(
      db,
      INVALID_ODDS,
      selections,
      "official_archive",
      "historical_closing_odds",
      (_combination, index) => index === 0 ? 1.0 : 2 + index,
    );
    insert(db, { ...VALID, raceId: "20240230-桐生-01", raceDate: "2024-02-30" }, selections, "official_archive", "historical_closing_odds");
    insert(db, { ...VALID, raceId: "20240106-桐生-13", raceDate: "2024-01-06", raceNo: 13 }, selections, "official_archive", "historical_closing_odds");

    assert.deepEqual(qualifyingRaceIds(db), [VALID.raceId]);
  } finally {
    db.close();
  }
});

test("trifecta grouped completeness ignores noncanonical source rows", () => {
  const db = setup();
  try {
    const selections = trifectaSelections();
    insert(db, VALID, selections, "official_archive", "historical_closing_odds");
    insert(db, VALID, selections.slice(0, 60), "secondary_archive", "historical_closing_odds");
    insert(db, DUPLICATE_SOURCE, selections.slice(0, 60), "official_archive", "historical_closing_odds");
    insert(db, DUPLICATE_SOURCE, selections.slice(60), "secondary_archive", "historical_closing_odds");

    const rows = db.prepare(`
      SELECT race_id
      FROM historical_alternative_odds
      WHERE bet_type = 'trifecta'
        AND ${historicalTrifectaCanonicalSourcePredicate()}
      GROUP BY race_id
      HAVING ${HISTORICAL_TRIFECTA_COMPLETE_MARKET_HAVING}
      ORDER BY race_id
    `).all() as Array<{ race_id: string }>;

    assert.deepEqual(rows.map((row) => row.race_id), [VALID.raceId]);
  } finally {
    db.close();
  }
});
