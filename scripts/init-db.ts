import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

mkdirSync("data", { recursive: true });
const db = new DatabaseSync("data/boat.sqlite");

db.exec(`
CREATE TABLE IF NOT EXISTS race_results (
  race_id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  venue TEXT NOT NULL,
  race_no INTEGER NOT NULL,
  trifecta TEXT,
  payout_yen INTEGER,
  popularity INTEGER,
  returned INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS decision_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  race_id TEXT NOT NULL,
  date TEXT NOT NULL,
  venue TEXT NOT NULL,
  race_no INTEGER NOT NULL,
  bet_type TEXT NOT NULL,
  selection TEXT NOT NULL,
  estimated_hit_rate REAL NOT NULL,
  required_odds REAL NOT NULL,
  current_odds REAL,
  ev REAL,
  decision TEXT NOT NULL,
  actually_bought INTEGER NOT NULL DEFAULT 0,
  stake_yen INTEGER NOT NULL DEFAULT 0,
  result TEXT,
  payout_yen INTEGER,
  popularity INTEGER,
  returned INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

db.close();
console.log("initialized data/boat.sqlite");
