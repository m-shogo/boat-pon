import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { parseOfficialResultDetail } from "../domain/officialResultDetailParser";
import { reconcileSanitizedKFixture } from "./n1SettlementAudit";

test("reconciliation counts legacy-only payout selections", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-n1-reconcile-"));
  const dbPath = join(root, "legacy.sqlite");
  const fixturePath = join(process.cwd(), "tests", "fixtures", "K260520.TXT");
  const fixture = new TextDecoder("shift_jis").decode(readFileSync(fixturePath));
  const parsed = parseOfficialResultDetail(fixture, {
    date: "2026-05-20",
    fetchedAt: "1970-01-01T00:00:00.000Z",
  });
  const sample = parsed.payouts.find((line) => line.payoutYen !== null);
  assert.ok(sample, "fixture must contain at least one payout line");

  const db = new DatabaseSync(dbPath);
  try {
    db.exec(`
      CREATE TABLE race_payouts (
        race_id TEXT NOT NULL,
        bet_type TEXT NOT NULL,
        combination TEXT NOT NULL,
        payout_yen INTEGER NOT NULL
      ) STRICT;
    `);
    const insert = db.prepare(`
      INSERT INTO race_payouts (race_id, bet_type, combination, payout_yen)
      VALUES (?, ?, ?, ?)
    `);
    insert.run(sample.raceId, sample.betType, sample.combination, sample.payoutYen);
    insert.run(sample.raceId, sample.betType, "__legacy_only__", 777);
  } finally {
    db.close();
  }

  try {
    const report = reconcileSanitizedKFixture(dbPath, fixturePath);
    assert.equal(report.legacyOnly, 1);
    assert.ok(report.exactMatch >= 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
