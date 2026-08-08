import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { buildOfficialProgramCanaryManifest } from "./n2OfficialProgramCanary";
import {
  canonicalDatabaseTimestamp,
  normalizeDiscoveryProgramRow,
  officialProgramDecisionCutoffUtc,
  readN2EdgeDiscoverySource,
} from "./n2EdgeDiscoverySource";

function withDatabases(fn: (paths: { primary: string; sidecar: string }, dbs: { primary: DatabaseSync; sidecar: DatabaseSync }) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-n2-edge-source-"));
  const primaryPath = join(root, "primary.sqlite");
  const sidecarPath = join(root, "sidecar.sqlite");
  const primary = new DatabaseSync(primaryPath);
  const sidecar = new DatabaseSync(sidecarPath);
  primary.exec(`
    CREATE TABLE official_programs (
      race_id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      venue TEXT NOT NULL,
      race_no INTEGER NOT NULL,
      close_at TEXT NOT NULL,
      source_file TEXT NOT NULL,
      raw_json TEXT NOT NULL,
      imported_at TEXT NOT NULL
    );
  `);
  sidecar.exec(`
    CREATE TABLE settlement_candidates_v2 (
      candidate_id TEXT PRIMARY KEY,
      canonical_race_key TEXT NOT NULL,
      bet_type TEXT NOT NULL,
      settlement_status TEXT NOT NULL,
      result_kind TEXT NOT NULL,
      resolution_status TEXT NOT NULL,
      observation_id TEXT NOT NULL,
      supersedes_candidate_id TEXT
    );
    CREATE TABLE race_payout_lines_v2 (
      payout_line_id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL,
      line_no INTEGER NOT NULL,
      bet_type TEXT NOT NULL,
      selection_canonical TEXT,
      payout_yen INTEGER NOT NULL,
      line_kind TEXT NOT NULL
    );
    CREATE TABLE settlement_source_duplicate_resolutions_v2 (
      duplicate_observation_id TEXT NOT NULL
    );
  `);
  try { fn({ primary: primaryPath, sidecar: sidecarPath }, { primary, sidecar }); }
  finally {
    try { primary.close(); } catch { /* already closed */ }
    try { sidecar.close(); } catch { /* already closed */ }
    rmSync(root, { recursive: true, force: true });
  }
}

function insertWinner(db: DatabaseSync, id: string, raceKey: string, selection: string): void {
  db.prepare(`INSERT INTO settlement_candidates_v2
    (candidate_id,canonical_race_key,bet_type,settlement_status,result_kind,resolution_status,observation_id,supersedes_candidate_id)
    VALUES (?,?, 'trifecta','settled','normal','resolved',?,NULL)`).run(id, raceKey, `obs-${id}`);
  db.prepare(`INSERT INTO race_payout_lines_v2
    (payout_line_id,candidate_id,line_no,bet_type,selection_canonical,payout_yen,line_kind)
    VALUES (?,?,1,'trifecta',?,1000,'payout')`).run(`p-${id}`, id, selection);
}

function insertProgram(db: DatabaseSync, input: {
  raceId: string;
  date: string;
  venue: string;
  raceNo: number;
  closeAt?: string;
  importedAt?: string;
}): void {
  db.prepare(`INSERT INTO official_programs
    (race_id,date,venue,race_no,close_at,source_file,raw_json,imported_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(
      input.raceId,
      input.date,
      input.venue,
      input.raceNo,
      input.closeAt ?? "23:00",
      `/cache/${input.raceId}.json`,
      JSON.stringify({ boats: [] }),
      input.importedAt ?? `${input.date} 01:00:00`,
    );
}

function canaryRawJson(): string {
  return JSON.stringify({
    boats: Array.from({ length: 6 }, (_, index) => ({
      course: index + 1,
      registrationNo: String(4000 + index),
      className: "B1",
      nationalWinRate: 5,
      nationalTop2Rate: 40,
      localWinRate: 5,
      localTop2Rate: 35,
      motorTop2Rate: 30,
      boatTop2Rate: 28,
    })),
  });
}

test("normalization matches the reviewed official-program canary on its known 2026 fixture", () => {
  const row = {
    raceId: "20260805-びわこ-01",
    date: "2026-08-05",
    venue: "びわこ",
    raceNo: 1,
    closeAt: "23:00",
    importedAt: "2026-08-05 01:00:00",
  };
  const normalized = normalizeDiscoveryProgramRow(row);
  const manifest = buildOfficialProgramCanaryManifest({
    rows: [{ ...row, sourceFile: "/private/cache/program.json", rawJson: canaryRawJson() }],
    cohort: { dateFrom: "2026-08-05", dateTo: "2026-08-05" },
    codeGitSha: "1234567890abcdef1234567890abcdef12345678",
    generatedAt: "2026-08-06T00:00:00.000Z",
  });
  assert.equal(manifest.binding.items.length, 1);
  const item = manifest.binding.items[0];
  assert.equal(normalized.canonicalRaceKey, item.canonicalRaceKey);
  assert.equal(normalized.primaryIdentityEncoding, item.primaryIdentityEncoding);
  assert.equal(normalized.decisionCutoff, item.decisionCutoff);
  assert.equal(normalized.sourceObservedAt, item.sourceObservedAt);
  assert.equal(normalized.canonicalRaceKey, "2026-08-05:11:R1");
  assert.equal(normalized.decisionCutoff, "2026-08-05T14:00:00.000Z");
  assert.equal(officialProgramDecisionCutoffUtc("2026-08-05", "23:00"), item.decisionCutoff);
  assert.equal(canonicalDatabaseTimestamp("2026-08-05 01:00:00"), item.sourceObservedAt);
});

test("source intersects clean winners with eligible pre-cutoff metadata and never reads raw_json", () => {
  withDatabases((paths, dbs) => {
    insertWinner(dbs.sidecar, "warm", "2003-12-31:11:R1", "1-3-2");
    insertWinner(dbs.sidecar, "a", "2004-01-01:11:R1", "1-2-3");
    insertWinner(dbs.sidecar, "b", "2004-01-01:11:R2", "2-1-3");
    insertProgram(dbs.primary, { raceId: "20040101-びわこ-01", date: "2004-01-01", venue: "びわこ", raceNo: 1 });
    insertProgram(dbs.primary, { raceId: "20040101-11-03", date: "2004-01-01", venue: "11", raceNo: 3 });
    dbs.primary.close();
    dbs.sidecar.close();

    const report = readN2EdgeDiscoverySource({ primaryDbPath: paths.primary, sidecarDbPath: paths.sidecar });
    assert.equal(report.status, "PASS");
    assert.equal(report.officialProgramMetadataCount, 2);
    assert.equal(report.eligibleProgramMetadataCount, 2);
    assert.equal(report.candidateRaceCount, 1);
    assert.equal(report.missingOfficialProgramCount, 1);
    assert.equal(report.missingCleanWinnerCount, 1);
    assert.deepEqual(report.candidates, [{
      canonicalRaceKey: "2004-01-01:11:R1",
      primaryRaceId: "20040101-びわこ-01",
      primaryIdentityEncoding: "venue_label",
      decisionCutoff: "2004-01-01T14:00:00.000Z",
      sourceObservedAt: "2004-01-01T01:00:00.000Z",
    }]);
    assert.equal(report.reads.rawJsonReadCount, 0);
    assert.equal(report.reads.primaryDatabaseWriteCount, 0);
    assert.equal(report.reads.sidecarDatabaseWriteCount, 0);
    assert.doesNotMatch(JSON.stringify(report), /raw_json|\/cache\//u);
  });
});

test("post-cutoff imports and arbitrary race-id aliases are excluded and explicitly counted", () => {
  withDatabases((paths, dbs) => {
    insertWinner(dbs.sidecar, "a", "2004-01-01:11:R1", "1-2-3");
    insertWinner(dbs.sidecar, "b", "2004-01-01:11:R2", "2-1-3");
    insertProgram(dbs.primary, {
      raceId: "20040101-びわこ-01", date: "2004-01-01", venue: "びわこ", raceNo: 1,
      closeAt: "22:59", importedAt: "2004-01-01 23:00:00",
    });
    insertProgram(dbs.primary, {
      raceId: "20040101-lake-biwa-02", date: "2004-01-01", venue: "びわこ", raceNo: 2,
    });
    dbs.primary.close();
    dbs.sidecar.close();
    const report = readN2EdgeDiscoverySource({ primaryDbPath: paths.primary, sidecarDbPath: paths.sidecar });
    assert.equal(report.status, "PASS");
    assert.equal(report.candidateRaceCount, 0);
    assert.equal(report.excludedProgramCount, 2);
    assert.equal(report.excludedProgramReasonCounts.POST_CUTOFF_PRIMARY_IMPORT, 1);
    assert.equal(report.excludedProgramReasonCounts.RACE_IDENTITY_MISMATCH, 1);
    assert.equal(report.missingOfficialProgramCount, 2);
  });
});

test("duplicate eligible label/code identities for one canonical race fail closed", () => {
  withDatabases((paths, dbs) => {
    insertWinner(dbs.sidecar, "a", "2004-01-01:11:R1", "1-2-3");
    insertProgram(dbs.primary, { raceId: "20040101-びわこ-01", date: "2004-01-01", venue: "びわこ", raceNo: 1 });
    insertProgram(dbs.primary, { raceId: "20040101-11-01", date: "2004-01-01", venue: "びわこ", raceNo: 1 });
    dbs.primary.close();
    dbs.sidecar.close();
    const report = readN2EdgeDiscoverySource({ primaryDbPath: paths.primary, sidecarDbPath: paths.sidecar });
    assert.equal(report.status, "BLOCKED");
    assert.ok(report.blockers.includes("2004-01-01:11:R1:DUPLICATE_ELIGIBLE_OFFICIAL_PROGRAM"));
    assert.equal(report.candidateRaceCount, 0);
  });
});

test("source output is deterministic", () => {
  withDatabases((paths, dbs) => {
    insertWinner(dbs.sidecar, "a", "2004-01-01:11:R1", "1-2-3");
    insertProgram(dbs.primary, { raceId: "20040101-びわこ-01", date: "2004-01-01", venue: "びわこ", raceNo: 1 });
    dbs.primary.close();
    dbs.sidecar.close();
    const first = readN2EdgeDiscoverySource({ primaryDbPath: paths.primary, sidecarDbPath: paths.sidecar });
    const second = readN2EdgeDiscoverySource({ primaryDbPath: paths.primary, sidecarDbPath: paths.sidecar });
    assert.equal(first.status, "PASS");
    assert.equal(first.outputDigest, second.outputDigest);
    assert.deepEqual(first.candidates, second.candidates);
    assert.deepEqual(first.historicalOutcomes, second.historicalOutcomes);
  });
});
