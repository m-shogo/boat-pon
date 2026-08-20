import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { canonicalHash } from "./canonical";
import { readN2ObservationIngestReadiness } from "./n2ObservationIngestReadinessReader";
import { N2_TRIFECTA_RAW_PARSER_VERSION } from "./n2TrifectaRawCaptureCanary";

function trifectaSelections(): string[] {
  const selections: string[] = [];
  for (let first = 1; first <= 6; first += 1) {
    for (let second = 1; second <= 6; second += 1) {
      if (second === first) continue;
      for (let third = 1; third <= 6; third += 1) {
        if (third === first || third === second) continue;
        selections.push(`${first}${second}${third}`);
      }
    }
  }
  return selections;
}

function parseRunId(rawDocumentId: string): string {
  return `parse-${canonicalHash({
    rawDocumentId,
    parserVersion: N2_TRIFECTA_RAW_PARSER_VERSION,
  }).slice(0, 40)}`;
}

test("readiness raw lineage requires every atomic PIT timestamp to stay on the race JST day", () => {
  const root = mkdtempSync(join(tmpdir(), "n2-readiness-pit-race-day-"));
  const primaryPath = join(root, "boat.sqlite");
  const sidecarPath = join(root, "research-replay.sqlite");
  const primary = new DatabaseSync(primaryPath);
  const sidecar = new DatabaseSync(sidecarPath);
  try {
    primary.exec(`
      CREATE TABLE official_programs (
        race_id TEXT PRIMARY KEY,
        date TEXT NOT NULL,
        venue TEXT NOT NULL,
        race_no INTEGER NOT NULL,
        close_at TEXT,
        source_file TEXT,
        raw_json TEXT,
        imported_at TEXT
      );
      INSERT INTO official_programs VALUES(
        '20260805-01-01','2026-08-05','01',1,'12:00','program.json','{}','2026-08-05T00:00:00.000Z'
      );
      CREATE TABLE trifecta_market_raw_snapshots (
        race_id TEXT NOT NULL,
        bet_type TEXT NOT NULL,
        bet_selection TEXT NOT NULL,
        odds REAL NOT NULL,
        captured_at TEXT NOT NULL,
        checkpoint_label TEXT NOT NULL,
        raw_document_id TEXT,
        raw_payload TEXT,
        raw_payload_digest TEXT,
        parse_run_id TEXT,
        source_url TEXT,
        available_at TEXT,
        decision_cutoff TEXT
      );
    `);
    const rawDocumentId = "raw-1";
    const rawPayload = "{}";
    const rawPayloadDigest = createHash("sha256").update(rawPayload, "utf8").digest("hex");
    const insert = primary.prepare("INSERT INTO trifecta_market_raw_snapshots VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)");
    for (const selection of trifectaSelections()) {
      insert.run(
        "20260805-01-01",
        "trifecta",
        selection,
        10.5,
        "2026-08-05T00:30:00.000Z",
        "T-30",
        rawDocumentId,
        rawPayload,
        rawPayloadDigest,
        parseRunId(rawDocumentId),
        "https://example.test/odds",
        "2026-08-04T14:59:59.000Z",
        "2026-08-05T15:00:00.000Z",
      );
    }
  } finally {
    primary.close();
    sidecar.close();
  }

  try {
    const result = readN2ObservationIngestReadiness({ primaryDbPath: primaryPath, sidecarDbPath: sidecarPath });
    assert.equal(result.input.primaryTrifectaMarket.completeSnapshotCount, 1);
    assert.equal(result.input.primaryTrifectaMarket.rawLineageCompleteSnapshotCount, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
