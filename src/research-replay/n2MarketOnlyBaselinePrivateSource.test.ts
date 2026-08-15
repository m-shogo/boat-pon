import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { readN2MarketOnlyBaselinePrivateSources } from "./n2MarketOnlyBaselinePrivateSource";

function html(multiplier = 1): string {
  const pairsByFirst = new Map<number, Array<[number, number]>>();
  for (let first = 1; first <= 6; first += 1) {
    const pairs: Array<[number, number]> = [];
    for (let second = 1; second <= 6; second += 1) {
      if (second === first) continue;
      for (let third = 1; third <= 6; third += 1) {
        if (third === first || third === second) continue;
        pairs.push([second, third]);
      }
    }
    pairsByFirst.set(first, pairs);
  }
  const header = Array.from({ length: 6 }, (_, index) => `<th colspan="3">${index + 1}</th>`).join("");
  const rows = Array.from({ length: 20 }, (_, rowIndex) => {
    const cells: string[] = [];
    for (let first = 1; first <= 6; first += 1) {
      const pair = pairsByFirst.get(first)?.[rowIndex];
      if (!pair) throw new Error("fixture pair missing");
      const odds = ((first * 100 + pair[0] * 10 + pair[1]) / 10) * multiplier;
      cells.push(`<td>${pair[0]}</td><td>${pair[1]}</td><td class="oddsPoint">${odds.toFixed(1)}</td>`);
    }
    return `<tr>${cells.join("")}</tr>`;
  }).join("");
  return `<!doctype html><html><body><table><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table></body></html>`;
}

function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function withRoot(fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-market-baseline-private-source-"));
  try { fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

function raceSpec(index: number): { date: string; venue: string; raceNo: number; raceKey: string } {
  const date = index < 12 ? "2026-08-07" : "2026-08-08";
  const raceNo = index < 12 ? index + 1 : index - 11;
  return { date, venue: "05", raceNo, raceKey: `${date}:05:R${raceNo}` };
}

type T5FixtureOptions = {
  tamperRaw?: boolean;
  acceptedAt?: string;
  decisionCutoff?: string;
  fetchedAt?: string;
  availableAt?: string;
};

function writeAcceptedT5(root: string, spec: ReturnType<typeof raceSpec>, options: T5FixtureOptions = {}): void {
  const raceDir = String(spec.raceNo).padStart(2, "0");
  const raceIdentity = `${spec.date.replaceAll("-", "")}-${spec.venue}-${raceDir}`;
  const dirRelative = `data/raw/research/trifecta-market/${spec.date}/${spec.venue}/${raceDir}/T-5`;
  const dir = join(root, dirRelative);
  mkdirSync(dir, { recursive: true });
  const raw = Buffer.from(html(1 + spec.raceNo / 100), "utf8");
  const digest = sha256(raw);
  const rawRelativePath = `${dirRelative}/fixture.html`;
  const envelopeRelativePath = `${dirRelative}/fixture.envelope.json`;
  const rawDocumentId = `raw-${spec.date}-${spec.venue}-${raceDir}`;
  const observationId = `obs-${spec.date}-${spec.venue}-${raceDir}`;
  const availableAt = options.availableAt ?? `${spec.date}T03:25:00.000Z`;
  const fetchedAt = options.fetchedAt ?? `${spec.date}T03:25:30.000Z`;
  const decisionCutoff = options.decisionCutoff ?? `${spec.date}T03:30:00.000Z`;
  writeFileSync(join(root, rawRelativePath), options.tamperRaw ? Buffer.from(`${raw.toString("utf8")}tamper`) : raw);
  writeFileSync(join(root, envelopeRelativePath), `${JSON.stringify({
    envelopeVersion: "n2-trifecta-private-capture-envelope-v1",
    status: "PASS",
    blockers: [],
    manifestDigest: "a".repeat(64),
    checkpointKey: "b".repeat(64),
    entry: { raceIdentity, checkpointLabel: "T-5", decisionCutoff },
    response: {
      statusCode: 200,
      contentType: "text/html",
      fetchedAt,
      rawByteLength: raw.length,
      rawSha256: digest,
      headers: {},
    },
    sourceDisplayedUpdate: { status: "PASS", availableAt },
    parserVersion: "n2-trifecta-raw-parser-v1",
    parsedSelectionCount: 120,
    unavailableSelectionCount: 0,
    rawDocumentId,
    parseRunId: `parse-${raceDir}`,
    proposedObservationId: observationId,
    snapshotCandidate: {},
    snapshotAudit: { status: "PASS", blockers: [] },
    rawRelativePath,
    envelopeRelativePath,
    acceptedMarkerRelativePath: `${dirRelative}/accepted.json`,
    databaseWriteAuthorized: false,
    currentBuyConnectionAuthorized: false,
    lineConnectionAuthorized: false,
    publicPublishAuthorized: false,
    productionApplyExecuted: false,
  }, null, 2)}\n`);
  writeFileSync(join(dir, "accepted.json"), `${JSON.stringify({
    markerVersion: "n2-trifecta-private-capture-accepted-v1",
    manifestDigest: "a".repeat(64),
    checkpointKey: "b".repeat(64),
    raceIdentity,
    checkpointLabel: "T-5",
    rawDocumentId,
    rawSha256: digest,
    rawRelativePath,
    envelopeRelativePath,
    acceptedAt: options.acceptedAt ?? `${spec.date}T03:25:30.000Z`,
    databaseWriteAuthorized: false,
    productionApplyExecuted: false,
  }, null, 2)}\n`);
}

function createSidecar(root: string): string {
  const path = join(root, "data/research-replay.sqlite");
  mkdirSync(join(root, "data"), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
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
      line_kind TEXT NOT NULL
    );
    CREATE TABLE settlement_source_duplicate_resolutions_v2 (
      duplicate_observation_id TEXT PRIMARY KEY
    );
  `);
  db.close();
  return path;
}

function insertSettlement(path: string, spec: ReturnType<typeof raceSpec>, index: number): void {
  const db = new DatabaseSync(path);
  try {
    const candidateId = `candidate-${index}`;
    db.prepare(`
      INSERT INTO settlement_candidates_v2 (
        candidate_id, canonical_race_key, bet_type, settlement_status,
        result_kind, resolution_status, observation_id, supersedes_candidate_id
      ) VALUES (?, ?, 'trifecta', 'settled', 'normal', 'resolved', ?, NULL)
    `).run(candidateId, spec.raceKey, `settlement-obs-${index}`);
    db.prepare(`
      INSERT INTO race_payout_lines_v2 (
        payout_line_id, candidate_id, line_no, bet_type, selection_canonical, line_kind
      ) VALUES (?, ?, 1, 'trifecta', '1-2-3', 'payout')
    `).run(`payout-${index}`, candidateId);
  } finally {
    db.close();
  }
}

function prepare(
  root: string,
  count: number,
  tamperIndex: number | null = null,
  fixtureOptions: (index: number) => T5FixtureOptions = () => ({}),
): string {
  const sidecar = createSidecar(root);
  for (let index = 0; index < count; index += 1) {
    const spec = raceSpec(index);
    writeAcceptedT5(root, spec, {
      ...fixtureOptions(index),
      tamperRaw: tamperIndex === index || fixtureOptions(index).tamperRaw,
    });
    insertSettlement(sidecar, spec, index);
  }
  return sidecar;
}

test("private source reader loads the fixed 20-race T-5 cohort with no network or writes", () => {
  withRoot((root) => {
    prepare(root, 20);
    const result = readN2MarketOnlyBaselinePrivateSources({ dataRoot: root });
    assert.equal(result.status, "PASS");
    assert.deepEqual(result.blockers, []);
    assert.equal(result.readinessStatus, "READY_FOR_N2_020");
    assert.equal(result.acceptedT5RaceCount, 20);
    assert.equal(result.settledAcceptedT5RaceCount, 20);
    assert.equal(result.selectedCohortRaceCount, 20);
    assert.equal(result.sources.length, 20);
    assert.equal(result.sources[0].selections.length, 120);
    assert.equal(result.sources[0].winningSelection, "1-2-3");
    assert.equal(result.databaseReadCount, 2);
    assert.equal(result.databaseWriteCount, 0);
    assert.equal(result.networkRequestCount, 0);
    assert.equal(result.rawValuesReadPrivately, true);
    assert.equal(result.rawValuesPublished, false);
    assert.equal(result.publicPublishAuthorized, false);
    assert.equal(result.productionApplyExecuted, false);
  });
});

test("private source reader blocks before raw-value loading when only 19 races are settled", () => {
  withRoot((root) => {
    prepare(root, 19);
    const result = readN2MarketOnlyBaselinePrivateSources({ dataRoot: root });
    assert.equal(result.status, "BLOCKED");
    assert.ok(result.blockers.includes("READINESS_ACCUMULATING"));
    assert.equal(result.sources.length, 0);
    assert.equal(result.rawValuesReadPrivately, false);
    assert.equal(result.networkRequestCount, 0);
    assert.equal(result.databaseWriteCount, 0);
  });
});

test("executor source loading revalidates raw SHA after readiness passes", () => {
  withRoot((root) => {
    prepare(root, 20, 4);
    const result = readN2MarketOnlyBaselinePrivateSources({ dataRoot: root });
    assert.equal(result.status, "BLOCKED");
    assert.ok(result.blockers.some((blocker) => blocker.includes("T5_RAW_SHA256_MISMATCH")));
    assert.equal(result.sources.length, 0);
    assert.equal(result.rawValuesPublished, false);
    assert.equal(result.databaseWriteCount, 0);
  });
});

test("private source reader stops at readiness for accepted marker timestamps normalized by Date.parse", () => {
  for (const acceptedAt of [
    "2026-02-30T03:25:30.000Z",
    "2026-08-07T24:00:00.000Z",
  ]) {
    withRoot((root) => {
      prepare(root, 20, null, (index) => index === 0 ? { acceptedAt } : {});
      const result = readN2MarketOnlyBaselinePrivateSources({ dataRoot: root });
      assert.equal(result.status, "BLOCKED", acceptedAt);
      assert.equal(result.readinessStatus, "BLOCKED", acceptedAt);
      assert.ok(result.blockers.includes("READINESS_BLOCKED"), acceptedAt);
      assert.ok(result.blockers.includes("PRIVATE_CAPTURE_INTEGRITY_BLOCKED:1"), acceptedAt);
      assert.equal(result.selectedCohortRaceCount, 0, acceptedAt);
      assert.equal(result.sources.length, 0, acceptedAt);
      assert.equal(result.privateRawFileReadCount, 0, acceptedAt);
      assert.equal(result.privateEnvelopeReadCount, 0, acceptedAt);
      assert.equal(result.rawValuesReadPrivately, false, acceptedAt);
      assert.equal(result.rawValuesPublished, false, acceptedAt);
      assert.equal(result.databaseReadCount, 1, acceptedAt);
      assert.equal(result.databaseWriteCount, 0, acceptedAt);
      assert.equal(result.networkRequestCount, 0, acceptedAt);
    });
  }
});

test("private source reader rejects impossible envelope timing metadata", () => {
  for (const [field, timestamp, blocker] of [
    ["decisionCutoff", "2026-08-07T24:00:00.000Z", "T5_DECISION_CUTOFF_INVALID"],
    ["fetchedAt", "2026-02-30T03:25:30.000Z", "T5_CAPTURED_AT_INVALID"],
    ["availableAt", "2026-08-07T23:60:00Z", "T5_AVAILABLE_AT_INVALID"],
  ] as const) {
    withRoot((root) => {
      prepare(root, 20, null, (index) => index === 0 ? { [field]: timestamp } : {});
      const result = readN2MarketOnlyBaselinePrivateSources({ dataRoot: root });
      assert.equal(result.status, "BLOCKED", `${field}:${timestamp}`);
      assert.ok(result.blockers.some((value) => value.includes(blocker)), `${field}:${timestamp}`);
      assert.equal(result.sources.length, 0);
      assert.equal(result.rawValuesPublished, false);
      assert.equal(result.databaseWriteCount, 0);
    });
  }
});

test("private source reader preserves valid leap-day and offset timestamps", () => {
  withRoot((root) => {
    prepare(root, 20, null, (index) => index === 0 ? {
      acceptedAt: "2024-02-29T12:25:30+09:00",
      decisionCutoff: "2026-08-07T12:30:00+09:00",
      fetchedAt: "2026-08-07T03:25:30Z",
      availableAt: "2026-08-07T03:25:00Z",
    } : {});
    const result = readN2MarketOnlyBaselinePrivateSources({ dataRoot: root });
    assert.equal(result.status, "PASS");
    assert.deepEqual(result.blockers, []);
  });
});
