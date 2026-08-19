import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { readN2MarketOnlyBaselinePrivateSources } from "./n2MarketOnlyBaselinePrivateSource";

function html(): string {
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
      const odds = (first * 100 + pair[0] * 10 + pair[1]) / 10;
      cells.push(`<td>${pair[0]}</td><td>${pair[1]}</td><td class="oddsPoint">${odds.toFixed(1)}</td>`);
    }
    return `<tr>${cells.join("")}</tr>`;
  }).join("");
  return `<!doctype html><html><body><table><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table></body></html>`;
}

function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function raceSpec(index: number): { date: string; venue: string; raceNo: number; raceKey: string } {
  const date = index < 12 ? "2026-08-07" : "2026-08-08";
  const raceNo = index < 12 ? index + 1 : index - 11;
  return { date, venue: "05", raceNo, raceKey: `${date}:05:R${raceNo}` };
}

function writeTamperedAcceptedT5(root: string, spec: ReturnType<typeof raceSpec>): void {
  const raceDir = String(spec.raceNo).padStart(2, "0");
  const raceIdentity = `${spec.date.replaceAll("-", "")}-${spec.venue}-${raceDir}`;
  const dirRelative = `data/raw/research/trifecta-market/${spec.date}/${spec.venue}/${raceDir}/T-5`;
  const dir = join(root, dirRelative);
  mkdirSync(dir, { recursive: true });
  const raw = Buffer.from(html(), "utf8");
  const digest = sha256(raw);
  const rawRelativePath = `${dirRelative}/fixture.html`;
  const envelopeRelativePath = `${dirRelative}/fixture.envelope.json`;
  const rawDocumentId = `raw-${spec.date}-${spec.venue}-${raceDir}`;
  writeFileSync(join(root, rawRelativePath), Buffer.from(`${raw.toString("utf8")}tamper`));
  writeFileSync(join(root, envelopeRelativePath), `${JSON.stringify({
    envelopeVersion: "n2-trifecta-private-capture-envelope-v1",
    status: "PASS",
    blockers: [],
    manifestDigest: "a".repeat(64),
    checkpointKey: "b".repeat(64),
    entry: {
      raceIdentity,
      checkpointLabel: "T-5",
      decisionCutoff: `${spec.date}T03:30:00.000Z`,
    },
    response: {
      statusCode: 200,
      contentType: "text/html",
      fetchedAt: `${spec.date}T03:25:30.000Z`,
      rawByteLength: raw.length,
      rawSha256: digest,
      headers: {},
    },
    sourceDisplayedUpdate: { status: "PASS", availableAt: `${spec.date}T03:25:00.000Z` },
    parserVersion: "n2-trifecta-raw-parser-v1",
    parsedSelectionCount: 120,
    unavailableSelectionCount: 0,
    rawDocumentId,
    parseRunId: `parse-${raceDir}`,
    proposedObservationId: `obs-${raceDir}`,
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
    acceptedAt: `${spec.date}T03:25:30.000Z`,
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

test("private read audit counts raw and envelope reads even when every raw SHA fails", () => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-market-baseline-private-audit-"));
  try {
    const sidecar = createSidecar(root);
    for (let index = 0; index < 20; index += 1) {
      const spec = raceSpec(index);
      writeTamperedAcceptedT5(root, spec);
      insertSettlement(sidecar, spec, index);
    }

    const result = readN2MarketOnlyBaselinePrivateSources({ dataRoot: root });
    assert.equal(result.status, "BLOCKED");
    assert.equal(result.sources.length, 0);
    assert.equal(result.privateEnvelopeReadCount, 20);
    assert.equal(result.privateRawFileReadCount, 20);
    assert.equal(result.rawValuesReadPrivately, false);
    assert.equal(result.blockers.filter((value) => value.includes("T5_RAW_SHA256_MISMATCH")).length, 20);
    assert.equal(result.rawValuesPublished, false);
    assert.equal(result.databaseWriteCount, 0);
    assert.equal(result.networkRequestCount, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
