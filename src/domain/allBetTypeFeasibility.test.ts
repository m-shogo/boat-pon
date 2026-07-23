import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ALL_BET_TYPES,
  BET_TYPE_CONTRACTS,
  buildRequestBudgetScenario,
  detectOfficialPayoutLabels,
  officialRaceUrl,
} from "./allBetTypeFeasibility";

test("7券種の公式画面と6艇時の買い目数を一意に定義する", () => {
  assert.deepEqual(BET_TYPE_CONTRACTS.map((row) => row.betType), ALL_BET_TYPES);
  assert.deepEqual(BET_TYPE_CONTRACTS.map((row) => row.expectedSelectionsForSixBoats), [6, 6, 30, 15, 15, 120, 20]);
  assert.equal(new Set(BET_TYPE_CONTRACTS.map((row) => row.betType)).size, 7);
});

test("全券種5画面を4 checkpointで取得する要求数を計算する", () => {
  assert.deepEqual(buildRequestBudgetScenario({
    name: "all-markets-4-checkpoints",
    racesPerDay: 144,
    checkpointsPerRace: 4,
    pagesPerCheckpoint: 5,
    resultPagesPerRace: 1,
  }), {
    name: "all-markets-4-checkpoints",
    racesPerDay: 144,
    checkpointsPerRace: 4,
    pagesPerCheckpoint: 5,
    resultPagesPerRace: 1,
    requestsPerDay: 3_024,
    minimumAverageIntervalSeconds: 86_400 / 3_024,
  });
});

test("公式race URLを日付・場コード・race番号付きで構築する", () => {
  assert.equal(
    officialRaceUrl("raceresult", { date: "2026-07-21", venueCode: "23", raceNo: 1 }),
    "https://www.boatrace.jp/owpc/pc/race/raceresult?hd=20260721&jcd=23&rno=1",
  );
});

test("既存の公式日次成績fixtureに7券種の払戻labelがある", () => {
  const buffer = readFileSync(join("tests", "fixtures", "K260520.TXT"));
  const text = new TextDecoder("shift_jis").decode(buffer);
  assert.deepEqual(detectOfficialPayoutLabels(text), ALL_BET_TYPES);
});

test("readOnlyかつquery_onlyのSQLite接続はfixture DBを書き換えない", () => {
  const directory = mkdtempSync(join(tmpdir(), "boat-pon-readonly-audit-"));
  const path = join(directory, "fixture.sqlite");
  try {
    const writable = new DatabaseSync(path);
    writable.exec("CREATE TABLE sample(id INTEGER PRIMARY KEY, value TEXT); INSERT INTO sample(value) VALUES ('before');");
    writable.close();
    const before = statSync(path);

    const readOnly = new DatabaseSync(path, { readOnly: true });
    readOnly.exec("PRAGMA query_only=ON;");
    assert.equal((readOnly.prepare("SELECT value FROM sample").get() as { value: string }).value, "before");
    assert.throws(() => readOnly.exec("INSERT INTO sample(value) VALUES ('after')"));
    assert.equal((readOnly.prepare("SELECT total_changes() AS n").get() as { n: number }).n, 0);
    readOnly.close();

    const after = statSync(path);
    assert.equal(after.size, before.size);
    assert.equal(after.mtimeMs, before.mtimeMs);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
