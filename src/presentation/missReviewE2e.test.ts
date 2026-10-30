import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

test("miss review reads official settlement despite empty history results, preserves database, validates date range", () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "boat-miss-review-")));
  const path = join(dir, "fixture.sqlite");
  const db = new DatabaseSync(path);
  try {
    db.exec(`
      CREATE TABLE decision_history (id INTEGER PRIMARY KEY, race_id TEXT, date TEXT, venue TEXT, race_no INTEGER, bet_type TEXT, selection TEXT, result TEXT, returned INTEGER, estimated_hit_rate REAL, current_odds REAL, ev REAL, recommended_stake_yen INTEGER, actually_bought INTEGER, stake_yen INTEGER, model_version TEXT, run_kind TEXT, decision TEXT);
      CREATE TABLE race_results (race_id TEXT PRIMARY KEY, trifecta TEXT, returned INTEGER);
      CREATE TABLE race_payouts (race_id TEXT, bet_type TEXT, combination TEXT, returned INTEGER, payout_yen INTEGER);
      INSERT INTO decision_history VALUES (1,'r1','2026-10-10','常滑',1,'3連単','1-2-3',NULL,0,.1,30,3,200,0,0,'test','paper-live','BUY');
      INSERT INTO decision_history VALUES (0,'r1','2026-10-10','常滑',1,'3連単','1-2-3',NULL,0,.9,30,3,200,0,0,'old','paper-live','BUY');
      INSERT INTO decision_history VALUES (2,'r2','2026-10-11','常滑',2,'3連単','1-2-3',NULL,0,.2,10,2,100,0,0,'test','paper-live','BUY');
      INSERT INTO decision_history VALUES (3,'r3','2026-09-30','常滑',3,'3連単','1-2-3',NULL,0,.9,90,81,100,0,0,'test','paper-live','BUY');
      INSERT INTO decision_history VALUES (4,'r4','2026-10-12','常滑',4,'3連単','1-2-3',NULL,0,.9,90,81,100,0,0,'test','paper-live','SKIP');
      INSERT INTO race_results VALUES ('r1','1-2-3',0),('r2','1-3-2',0),('r3','1-2-3',0),('r4','1-2-3',0);
      INSERT INTO race_payouts VALUES ('r1','trifecta','1-2-3',0,1200);
    `);
  } finally { db.close(); }
  const digest = () => createHash("sha256").update(readFileSync(path)).digest("hex");
  const run = (...args: string[]) => execFileSync(process.execPath, ["--import", "tsx", "scripts/report-miss-review.ts", ...args], { env: { ...process.env, BOAT_PON_DB_PATH: path }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  try {
    const before = digest();
    const args = ["--from", "2026-10-01", "--to", "2026-10-30"];
    const report = JSON.parse(run(...args, "--json"));
    assert.equal(report.queriedBuyCount, 3);
    assert.equal(report.deduplicatedBuyCount, 2);
    assert.ok(Math.abs(report.summary.expectedHits - .3) < 1e-14);
    assert.ok(Math.abs(report.summary.lowerTailProbability - .98) < 1e-14);
    assert.equal(report.money.paper.missingPayouts, 0);
    assert.equal(report.summary.count, 2);
    assert.equal(report.summary.hits, 1);
    assert.equal(report.money.paper.investedYen, 300);
    assert.equal(report.money.paper.payoutYen, 2400);
    assert.equal(report.money.paper.roi, 8);
    assert.equal(report.money.paper.currentOddsRoi, 20);
    const text = run(...args);
    assert.match(text, /保存BUY 3件 → 重複集約後 2件 \/ BUY確定 2件 \/ 的中 1件/);
    assert.match(text.split("\n").filter(Boolean)[3], /モデル・実行種別/);
    assert.match(text, /test \/ paper-live/);
    assert.doesNotMatch(text, /独立・同率/);
    assert.deepEqual(JSON.parse(run(...args, "--json", "--detail")), report);
    assert.throws(() => run("--from", "2026-02-30"));
    assert.throws(() => run("--from", "2026-10-30", "--to", "2026-10-01"));
    assert.equal(digest(), before);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
