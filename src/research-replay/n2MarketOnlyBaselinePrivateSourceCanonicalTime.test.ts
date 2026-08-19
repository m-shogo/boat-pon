import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { canonicalHash, canonicalUtcTimestamp } from "./canonical";
import { buildBoatRaceOfficialSourceUrl } from "./n2ExternalSourceCaptureContract";
import { buildN2MarketOnlyBaselineDataset } from "./n2MarketOnlyBaselineDataset";
import { readN2MarketOnlyBaselinePrivateSources } from "./n2MarketOnlyBaselinePrivateSource";

function html(): string {
  const rows = Array.from({ length: 20 }, (_, rowIndex) => {
    const cells: string[] = [];
    for (let first = 1; first <= 6; first += 1) {
      const remaining = [1, 2, 3, 4, 5, 6].filter((boat) => boat !== first);
      const pairs = remaining.flatMap((second) =>
        remaining.filter((third) => third !== second).map((third) => [second, third] as const));
      const pair = pairs[rowIndex];
      if (!pair) throw new Error("fixture pair missing");
      cells.push(`<td>${pair[0]}</td><td>${pair[1]}</td><td class="oddsPoint">${(10 + first + rowIndex / 10).toFixed(1)}</td>`);
    }
    return `<tr>${cells.join("")}</tr>`;
  }).join("");
  const header = Array.from({ length: 6 }, (_, index) => `<th colspan="3">${index + 1}</th>`).join("");
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

function writeAcceptedT5(root: string, spec: ReturnType<typeof raceSpec>, offsetTime = true): void {
  const raceDir = String(spec.raceNo).padStart(2, "0");
  const raceIdentity = `${spec.date.replaceAll("-", "")}-${spec.venue}-${raceDir}`;
  const base = `data/raw/research/trifecta-market/${spec.date}/${spec.venue}/${raceDir}/T-5`;
  const dir = join(root, base);
  mkdirSync(dir, { recursive: true });
  const raw = Buffer.from(html(), "utf8");
  const rawSha256 = sha256(raw);
  const rawRelativePath = `${base}/fixture.html`;
  const envelopeRelativePath = `${base}/fixture.envelope.json`;
  const rawDocumentId = `raw-${spec.date}-${spec.venue}-${raceDir}`;
  const decisionCutoff = offsetTime ? `${spec.date}T12:30:00+09:00` : `${spec.date}T03:30:00.000Z`;
  const fetchedAt = offsetTime ? `${spec.date}T12:25:30+09:00` : `${spec.date}T03:25:30.000Z`;
  const availableAt = offsetTime ? `${spec.date}T12:25:00+09:00` : `${spec.date}T03:25:00.000Z`;
  const manifestDigest = "a".repeat(64);
  const canonicalCutoff = canonicalUtcTimestamp(decisionCutoff);
  const targetCaptureAt = new Date(Date.parse(canonicalCutoff) - 5 * 60_000).toISOString();
  const sourceUrl = buildBoatRaceOfficialSourceUrl(
    "boatrace_official_trifecta_odds_html",
    { date: spec.date.replaceAll("-", ""), venueCode: spec.venue, raceNo: spec.raceNo },
  );
  const checkpointKey = canonicalHash({
    manifestDigest,
    raceIdentity,
    checkpointLabel: "T-5",
    targetCaptureAt,
    sourceUrl,
  });

  writeFileSync(join(root, rawRelativePath), raw);
  writeFileSync(join(root, envelopeRelativePath), `${JSON.stringify({
    envelopeVersion: "n2-trifecta-private-capture-envelope-v1",
    status: "PASS",
    blockers: [],
    manifestDigest,
    checkpointKey,
    entry: { raceIdentity, checkpointLabel: "T-5", targetCaptureAt, decisionCutoff, sourceUrl },
    response: {
      statusCode: 200,
      contentType: "text/html",
      fetchedAt,
      rawByteLength: raw.length,
      rawSha256,
      headers: {},
    },
    sourceDisplayedUpdate: { status: "PASS", availableAt },
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
    acceptedMarkerRelativePath: `${base}/accepted.json`,
    databaseWriteAuthorized: false,
    currentBuyConnectionAuthorized: false,
    lineConnectionAuthorized: false,
    publicPublishAuthorized: false,
    productionApplyExecuted: false,
  }, null, 2)}\n`);
  writeFileSync(join(dir, "accepted.json"), `${JSON.stringify({
    markerVersion: "n2-trifecta-private-capture-accepted-v1",
    manifestDigest,
    checkpointKey,
    raceIdentity,
    checkpointLabel: "T-5",
    rawDocumentId,
    rawSha256,
    rawRelativePath,
    envelopeRelativePath,
    acceptedAt: offsetTime ? `${spec.date}T12:25:30+09:00` : `${spec.date}T03:25:30.000Z`,
    databaseWriteAuthorized: false,
    productionApplyExecuted: false,
  }, null, 2)}\n`);
}

function withRoot(fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-market-canonical-time-"));
  try {
    const sidecar = createSidecar(root);
    for (let index = 0; index < 20; index += 1) {
      const spec = raceSpec(index);
      writeAcceptedT5(root, spec, true);
      insertSettlement(sidecar, spec, index);
    }
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("private source canonicalizes valid offset times before dataset assembly", () => {
  withRoot((root) => {
    const read = readN2MarketOnlyBaselinePrivateSources({ dataRoot: root });
    assert.equal(read.status, "PASS");
    assert.equal(read.sources.length, 20);
    for (const source of read.sources) {
      assert.match(source.decisionCutoff, /T03:30:00\.000Z$/u);
      assert.match(source.capturedAt, /T03:25:30\.000Z$/u);
      assert.match(source.availableAt, /T03:25:00\.000Z$/u);
    }

    const dataset = buildN2MarketOnlyBaselineDataset({ sources: read.sources });
    assert.equal(dataset.status, "PASS");
    assert.equal(dataset.cohortRaceCount, 20);
    assert.equal(dataset.rowCount, 20 * 120);
  });
});
