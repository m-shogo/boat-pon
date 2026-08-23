import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RawStore } from "./rawStore";
import { ResearchReplayRepository } from "./repository";
import { initializeSidecarSchema, openSidecarDatabase } from "./schema";

test("parseTypedRawDocumentはineligible rawからparse evidenceをappendしない", (t) => {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-raw-replay-eligibility-"));
  const db = openSidecarDatabase(join(root, "sidecar.sqlite"));
  initializeSidecarSchema(db, "2026-08-24T00:00:00.000Z");
  const rawStore = new RawStore(join(root, "raw"));
  const repository = new ResearchReplayRepository(
    db,
    rawStore,
    () => "unused-id",
    () => "2026-08-24T00:00:00.000Z",
  );
  t.after(() => {
    db.close();
    rmSync(root, { recursive: true, force: true });
  });

  const cases = [
    { id: "quarantined-integrity", integrity: "quarantined", security: "passed", replayEligible: 1 },
    { id: "quarantined-security", integrity: "verified", security: "quarantined", replayEligible: 1 },
    { id: "replay-disabled", integrity: "verified", security: "passed", replayEligible: 0 },
  ] as const;

  for (const item of cases) {
    const bytes = Buffer.from(JSON.stringify({ case: item.id }), "utf8");
    const write = rawStore.write({ bytes, contentType: "application/json", charset: "utf-8" });
    db.prepare(`
      INSERT INTO raw_documents
      (raw_document_id, raw_sha256, entity_body_byte_length, content_type, charset,
       content_encoding, compressed_byte_length, decompression_ratio, integrity_status,
       storage_type, storage_path, first_recorded_at, retention_class,
       parser_replay_eligible, security_scan_status, created_at)
      VALUES (?, ?, ?, 'application/json', 'utf-8', NULL, NULL, NULL, ?,
              'content_addressed_filesystem', ?, ?, 'research_evidence', ?, ?, ?)
    `).run(
      item.id,
      write.rawSha256,
      write.byteLength,
      item.integrity,
      write.relativePath,
      "2026-08-24T00:00:00.000Z",
      item.replayEligible,
      item.security,
      "2026-08-24T00:00:00.000Z",
    );

    assert.throws(
      () => repository.parseFixtureEnvelope({ rawDocumentId: item.id, parserVersion: "test-parser-v1" }),
      /RAW_DOCUMENT_REPLAY_INELIGIBLE/,
    );
  }

  const parseRuns = db.prepare("SELECT COUNT(*) AS count FROM parse_runs").get() as { count: number };
  const observations = db.prepare("SELECT COUNT(*) AS count FROM domain_observations").get() as { count: number };
  assert.equal(parseRuns.count, 0);
  assert.equal(observations.count, 0);
});