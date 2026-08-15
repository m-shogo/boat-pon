import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { enumerateBetSelections } from "./n2DatasetContract";
import { buildN2FeatureCoverageProfile } from "./n2FeatureCoverage";
import { readTrifectaMarketCoverageEvents } from "./n2OddsCoverageReader";
import { semanticPayloadHash } from "./domain";

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function payload(observedAt: string, selections = enumerateBetSelections("trifecta")): string {
  return JSON.stringify({
    selections: selections.map((selection, index) => ({ selection, odds: 10 + index / 10 })),
    scheduledCloseObservationId: "schedule-1",
    scheduledCloseAtSeen: "2026-05-20T03:00:00Z",
    observedAt,
    minutesBeforeCloseAtCapture: 5,
    checkpointLabelAtCapture: "T-5",
    checkpointPolicyVersion: "t-minus-nearest-v1",
    marketKind: "live_checkpoint",
  });
}

function payloadSemanticHash(payloadJson: string): string {
  return semanticPayloadHash("trifecta_market", JSON.parse(payloadJson) as unknown);
}

function createFixture(): { dir: string; primaryPath: string; sidecarPath: string } {
  const dir = mkdtempSync(join(tmpdir(), "n2-odds-coverage-"));
  const primaryPath = join(dir, "primary.sqlite");
  const sidecarPath = join(dir, "sidecar.sqlite");
  const primary = new DatabaseSync(primaryPath);
  primary.exec(`
    CREATE TABLE official_programs (
      race_id TEXT PRIMARY KEY, date TEXT NOT NULL, venue TEXT NOT NULL, race_no INTEGER NOT NULL,
      source_file TEXT NOT NULL, raw_json TEXT NOT NULL, imported_at TEXT NOT NULL
    );
    CREATE TABLE odds_timeseries_snapshots (
      id INTEGER PRIMARY KEY, race_id TEXT NOT NULL, selection TEXT NOT NULL, odds REAL NOT NULL,
      source TEXT NOT NULL, captured_at TEXT NOT NULL
    );
    INSERT INTO official_programs VALUES
      ('20260520-01-01','2026-05-20','01',1,'program-a','{}','2026-05-20T00:00:00Z'),
      ('20260521-01-01','2026-05-21','01',1,'program-b','{}','2026-05-21T00:00:00Z');
    INSERT INTO odds_timeseries_snapshots VALUES
      (1,'20260521-01-01','1-2-3',12.3,'legacy-without-bet-type','2026-05-21T02:55:00Z');
  `);
  primary.close();
  const sidecar = new DatabaseSync(sidecarPath);
  sidecar.exec(`
    CREATE TABLE raw_documents (
      raw_document_id TEXT PRIMARY KEY, integrity_status TEXT NOT NULL,
      security_scan_status TEXT NOT NULL, parser_replay_eligible INTEGER NOT NULL
    );
    CREATE TABLE parse_runs (
      parse_run_id TEXT PRIMARY KEY, raw_document_id TEXT NOT NULL, status TEXT NOT NULL
    );
    CREATE TABLE domain_observations (
      observation_id TEXT PRIMARY KEY, canonical_race_key TEXT NOT NULL, observation_type TEXT NOT NULL,
      payload_type TEXT NOT NULL, payload_schema_version TEXT NOT NULL, semantic_payload_hash TEXT NOT NULL,
      raw_document_id TEXT NOT NULL, parse_run_id TEXT NOT NULL, source_published_at TEXT,
      source_observed_at TEXT NOT NULL, first_seen_at TEXT NOT NULL,
      timing_quality TEXT NOT NULL, source_quality TEXT NOT NULL
    );
    CREATE TABLE typed_observation_payloads (
      observation_id TEXT PRIMARY KEY, payload_type TEXT NOT NULL,
      payload_schema_version TEXT NOT NULL, payload_json TEXT NOT NULL, payload_hash TEXT NOT NULL
    );
  `);
  sidecar.close();
  return { dir, primaryPath, sidecarPath };
}

function insertMarket(input: {
  sidecarPath: string;
  suffix: string;
  raceKey: string;
  observedAt: string;
  payloadJson: string;
  payloadHash?: string;
}): void {
  const db = new DatabaseSync(input.sidecarPath);
  const hash = input.payloadHash ?? payloadSemanticHash(input.payloadJson);
  db.prepare("INSERT INTO raw_documents VALUES (?, 'verified', 'passed', 1)").run(`raw-${input.suffix}`);
  db.prepare("INSERT INTO parse_runs VALUES (?, ?, 'success')").run(`parse-${input.suffix}`, `raw-${input.suffix}`);
  db.prepare(`INSERT INTO domain_observations VALUES (?, ?, 'trifecta_market', 'trifecta_market',
      'rr-payload-v1', ?, ?, ?, NULL, ?, ?, 'observed_only', 'official_public')`).run(
    `obs-${input.suffix}`, input.raceKey, hash, `raw-${input.suffix}`, `parse-${input.suffix}`,
    input.observedAt, input.observedAt,
  );
  db.prepare("INSERT INTO typed_observation_payloads VALUES (?, 'trifecta_market', 'rr-payload-v1', ?, ?)")
    .run(`obs-${input.suffix}`, input.payloadJson, hash);
  db.close();
}

test("F0 trifecta T-5 is verified while legacy odds without bet_type is never promoted", () => {
  const fixture = createFixture();
  try {
    insertMarket({
      sidecarPath: fixture.sidecarPath,
      suffix: "complete",
      raceKey: "2026-05-20:01:R1",
      observedAt: "2026-05-20T02:55:00Z",
      payloadJson: payload("2026-05-20T02:55:00Z"),
    });
    const beforePrimary = sha256(fixture.primaryPath);
    const beforeSidecar = sha256(fixture.sidecarPath);
    const events = readTrifectaMarketCoverageEvents({
      primaryDbPath: fixture.primaryPath, sidecarDbPath: fixture.sidecarPath,
      dateFrom: "2026-05-20", dateTo: "2026-05-21", checkpoint: "T-5",
    });
    assert.equal(events.length, 240);
    assert.equal(events.filter((event) => event.status === "verified").length, 120);
    assert.equal(events.filter((event) => event.exclusionReason === "excluded_market_checkpoint_not_found").length, 120);
    assert.ok(events.every((event) => event.key.startsWith("trifecta:T-5:")));
    const profile = buildN2FeatureCoverageProfile({ inputKind: "real", events });
    assert.equal(profile.overall.coveragePct, 50);
    assert.equal(sha256(fixture.primaryPath), beforePrimary);
    assert.equal(sha256(fixture.sidecarPath), beforeSidecar);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("incomplete typed market preserves per-selection exclusion", () => {
  const fixture = createFixture();
  try {
    const selections = enumerateBetSelections("trifecta").slice(0, -1);
    insertMarket({
      sidecarPath: fixture.sidecarPath,
      suffix: "partial",
      raceKey: "2026-05-20:01:R1",
      observedAt: "2026-05-20T02:55:00Z",
      payloadJson: payload("2026-05-20T02:55:00Z", selections),
    });
    const events = readTrifectaMarketCoverageEvents({
      primaryDbPath: fixture.primaryPath, sidecarDbPath: fixture.sidecarPath,
      dateFrom: "2026-05-20", dateTo: "2026-05-20", checkpoint: "T-5",
    });
    assert.equal(events.filter((event) => event.status === "verified").length, 119);
    assert.equal(events.filter((event) => event.exclusionReason === "excluded_missing_market_selection").length, 1);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("two observations for the same checkpoint fail closed", () => {
  const fixture = createFixture();
  try {
    for (const suffix of ["a", "b"]) insertMarket({
      sidecarPath: fixture.sidecarPath,
      suffix,
      raceKey: "2026-05-20:01:R1",
      observedAt: "2026-05-20T02:55:00Z",
      payloadJson: payload("2026-05-20T02:55:00Z"),
    });
    const events = readTrifectaMarketCoverageEvents({
      primaryDbPath: fixture.primaryPath, sidecarDbPath: fixture.sidecarPath,
      dateFrom: "2026-05-20", dateTo: "2026-05-20", checkpoint: "T-5",
    });
    assert.equal(events.length, 120);
    assert.ok(events.every((event) => event.exclusionReason === "excluded_market_checkpoint_ambiguous"));
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("typed payload hash mismatch is rejected", () => {
  const fixture = createFixture();
  try {
    insertMarket({
      sidecarPath: fixture.sidecarPath,
      suffix: "hash-mismatch",
      raceKey: "2026-05-20:01:R1",
      observedAt: "2026-05-20T02:55:00Z",
      payloadJson: payload("2026-05-20T02:55:00Z"),
      payloadHash: "same-at-insert",
    });
    const db = new DatabaseSync(fixture.sidecarPath);
    db.exec("UPDATE typed_observation_payloads SET payload_hash = 'tampered'");
    db.close();
    const events = readTrifectaMarketCoverageEvents({
      primaryDbPath: fixture.primaryPath, sidecarDbPath: fixture.sidecarPath,
      dateFrom: "2026-05-20", dateTo: "2026-05-20", checkpoint: "T-5",
    });
    assert.equal(events.length, 120);
    assert.ok(events.every((event) => event.exclusionReason === "excluded_invalid_market_payload"));
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test("typed payload body tampering is rejected even when stored hashes still agree", () => {
  const fixture = createFixture();
  try {
    const original = payload("2026-05-20T02:55:00Z");
    insertMarket({
      sidecarPath: fixture.sidecarPath,
      suffix: "body-tamper",
      raceKey: "2026-05-20:01:R1",
      observedAt: "2026-05-20T02:55:00Z",
      payloadJson: original,
    });
    const tampered = JSON.parse(original) as {
      selections: Array<{ selection: string; odds: number }>;
    };
    tampered.selections[0].odds += 100;
    const db = new DatabaseSync(fixture.sidecarPath);
    db.prepare("UPDATE typed_observation_payloads SET payload_json = ? WHERE observation_id = 'obs-body-tamper'")
      .run(JSON.stringify(tampered));
    db.close();

    const events = readTrifectaMarketCoverageEvents({
      primaryDbPath: fixture.primaryPath, sidecarDbPath: fixture.sidecarPath,
      dateFrom: "2026-05-20", dateTo: "2026-05-20", checkpoint: "T-5",
    });
    assert.equal(events.length, 120);
    assert.ok(events.every((event) => event.exclusionReason === "excluded_invalid_market_payload"));
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});
