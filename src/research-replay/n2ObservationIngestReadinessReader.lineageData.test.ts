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

test("readiness requires raw payload, parse lineage, and one source URL lineage to match producer identity", () => {
  const root = mkdtempSync(join(tmpdir(), "n2-readiness-lineage-data-"));
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
        source_url TEXT
      );
    `);
    const insert = primary.prepare("INSERT INTO trifecta_market_raw_snapshots VALUES(?,?,?,?,?,?,?,?,?,?,?)");
    for (const selection of trifectaSelections()) {
      insert.run(
        "20260805-01-01",
        "trifecta",
        selection,
        10.5,
        "2026-08-05T00:30:00.000Z",
        "T-30",
        "",
        "",
        "",
        "",
        "",
      );
    }
  } finally {
    primary.close();
    sidecar.close();
  }

  try {
    const withoutLineage = readN2ObservationIngestReadiness({ primaryDbPath: primaryPath, sidecarDbPath: sidecarPath });
    assert.equal(withoutLineage.input.primaryTrifectaMarket.completeSnapshotCount, 1);
    assert.equal(withoutLineage.input.primaryTrifectaMarket.rawLineageCompleteSnapshotCount, 0);

    const db = new DatabaseSync(primaryPath);
    try {
      db.prepare(`
        UPDATE trifecta_market_raw_snapshots
        SET raw_document_id='raw-1', raw_payload='{}', raw_payload_digest=?, parse_run_id='parse-forged', source_url='https://example.test/odds'
      `).run("a".repeat(64));
    } finally {
      db.close();
    }

    const forgedDigest = readN2ObservationIngestReadiness({ primaryDbPath: primaryPath, sidecarDbPath: sidecarPath });
    assert.equal(forgedDigest.input.primaryTrifectaMarket.completeSnapshotCount, 1);
    assert.equal(forgedDigest.input.primaryTrifectaMarket.rawLineageCompleteSnapshotCount, 0);

    const validDigest = createHash("sha256").update("{}", "utf8").digest("hex");
    const validDb = new DatabaseSync(primaryPath);
    try {
      validDb.prepare("UPDATE trifecta_market_raw_snapshots SET raw_payload_digest=?").run(validDigest);
    } finally {
      validDb.close();
    }

    const forgedParseLineage = readN2ObservationIngestReadiness({ primaryDbPath: primaryPath, sidecarDbPath: sidecarPath });
    assert.equal(forgedParseLineage.input.primaryTrifectaMarket.completeSnapshotCount, 1);
    assert.equal(forgedParseLineage.input.primaryTrifectaMarket.rawLineageCompleteSnapshotCount, 0);

    const producerValidDb = new DatabaseSync(primaryPath);
    try {
      producerValidDb.prepare("UPDATE trifecta_market_raw_snapshots SET parse_run_id=?")
        .run(parseRunId("raw-1"));
    } finally {
      producerValidDb.close();
    }

    const withLineage = readN2ObservationIngestReadiness({ primaryDbPath: primaryPath, sidecarDbPath: sidecarPath });
    assert.equal(withLineage.input.primaryTrifectaMarket.completeSnapshotCount, 1);
    assert.equal(withLineage.input.primaryTrifectaMarket.rawLineageCompleteSnapshotCount, 1);

    const missingSourceDb = new DatabaseSync(primaryPath);
    try {
      missingSourceDb.prepare("UPDATE trifecta_market_raw_snapshots SET source_url='' WHERE bet_selection='123'").run();
    } finally {
      missingSourceDb.close();
    }

    const missingSource = readN2ObservationIngestReadiness({ primaryDbPath: primaryPath, sidecarDbPath: sidecarPath });
    assert.equal(missingSource.input.primaryTrifectaMarket.completeSnapshotCount, 1);
    assert.equal(missingSource.input.primaryTrifectaMarket.rawLineageCompleteSnapshotCount, 0);

    const mixedSourceDb = new DatabaseSync(primaryPath);
    try {
      mixedSourceDb.prepare("UPDATE trifecta_market_raw_snapshots SET source_url='https://example.test/odds'").run();
      mixedSourceDb.prepare("UPDATE trifecta_market_raw_snapshots SET source_url='https://example.test/other' WHERE bet_selection='123'").run();
    } finally {
      mixedSourceDb.close();
    }

    const mixedSource = readN2ObservationIngestReadiness({ primaryDbPath: primaryPath, sidecarDbPath: sidecarPath });
    assert.equal(mixedSource.input.primaryTrifectaMarket.completeSnapshotCount, 1);
    assert.equal(mixedSource.input.primaryTrifectaMarket.rawLineageCompleteSnapshotCount, 0);

    const mixedLineageDb = new DatabaseSync(primaryPath);
    try {
      mixedLineageDb.prepare("UPDATE trifecta_market_raw_snapshots SET source_url='https://example.test/odds'").run();
      mixedLineageDb.prepare(`
        UPDATE trifecta_market_raw_snapshots
        SET raw_document_id=?, parse_run_id=?
        WHERE bet_selection=?
      `).run("raw-2", parseRunId("raw-2"), "123");
    } finally {
      mixedLineageDb.close();
    }

    const mixedLineage = readN2ObservationIngestReadiness({ primaryDbPath: primaryPath, sidecarDbPath: sidecarPath });
    assert.equal(mixedLineage.input.primaryTrifectaMarket.completeSnapshotCount, 1);
    assert.equal(mixedLineage.input.primaryTrifectaMarket.rawLineageCompleteSnapshotCount, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
