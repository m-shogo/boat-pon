import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { applySourceDuplicateResolution, auditCanonicalDuplicates, planSourceDuplicateResolution } from "./n1CanonicalResolution";
import { RawStore } from "./rawStore";
import { ResearchReplayRepository } from "./repository";
import { initializeSidecarSchema, openSidecarDatabase } from "./schema";
import { initializeN1CanonicalResolutionSchema, initializeN1SettlementSchema, SettlementRepository } from "./settlement";

const NOW = "2026-08-22T12:00:00.000Z";
const RACE_KEY = "2026-08-22:01:R1";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "n1-canonical-audit-evidence-"));
  const db = openSidecarDatabase(join(root, "sidecar.sqlite"));
  initializeSidecarSchema(db, NOW);
  initializeN1SettlementSchema(db, NOW);
  initializeN1CanonicalResolutionSchema(db, NOW);

  const replay = new ResearchReplayRepository(db, new RawStore(join(root, "raw")), undefined, () => NOW);
  const raw = replay.recordRawDocument({ bytes: Buffer.from("same-source"), contentType: "text/plain", charset: "utf-8" });
  const parseRunId = "parse-source";
  db.prepare(`INSERT INTO parse_runs
    (parse_run_id,raw_document_id,parser_name,parser_version,source_schema_version,canonicalization_version,
     payload_type,status,warning_codes,error_code,started_at,completed_at,semantic_payload_hash,
     supersedes_id,correction_kind,correction_reason,created_at)
    VALUES (?,?, 'audit-test','v1','audit-v1','rr-c14n-v1','settlement_result','success','[]',NULL,?,?,'hash',NULL,NULL,NULL,?)`)
    .run(parseRunId, raw.rawDocumentId, NOW, NOW, NOW);

  const insertObservation = db.prepare(`INSERT INTO domain_observations
    (observation_id,canonical_race_key,observation_type,payload_type,payload_schema_version,parse_run_id,
     raw_document_id,source_published_at,source_observed_at,first_seen_at,timing_quality,source_quality,
     measurement_quality,semantic_payload_hash,supersedes_id,correction_kind,correction_reason,
     recorded_at,effective_at,created_at)
    VALUES (?,?,'settlement_result','settlement_result','rr-payload-v1',?,?,NULL,?,?,'observed_only',
            'official_public','audit-test',?,NULL,NULL,NULL,?,?,?)`);
  insertObservation.run("obs-canonical", RACE_KEY, parseRunId, raw.rawDocumentId, NOW, NOW, "obs-hash-1", NOW, NOW, NOW);
  insertObservation.run("obs-duplicate", RACE_KEY, parseRunId, raw.rawDocumentId, NOW, NOW, "obs-hash-2", NOW, NOW, NOW);

  const settlement = new SettlementRepository(db);
  const canonical = settlement.appendCandidate({
    canonicalRaceKey: RACE_KEY,
    betType: "win",
    settlementStatus: "settled",
    resultKind: "normal",
    revisionKind: "initial",
    resolutionStatus: "resolved",
    sourceKind: "official_archive",
    sourceSchemaVersion: "audit-v1",
    observationId: "obs-canonical",
    parseRunId,
    rawDocumentId: raw.rawDocumentId,
    observedAt: NOW,
    payouts: [{ selection: "1", payoutYen: 100 }],
    emitEvidencePins: false,
  });
  const duplicate = settlement.appendCandidate({
    canonicalRaceKey: RACE_KEY,
    betType: "win",
    settlementStatus: "settled",
    resultKind: "normal",
    revisionKind: "initial",
    resolutionStatus: "resolved",
    sourceKind: "official_archive",
    sourceSchemaVersion: "audit-v1",
    observationId: "obs-duplicate",
    parseRunId,
    rawDocumentId: raw.rawDocumentId,
    observedAt: NOW,
    payouts: [{ selection: "1", payoutYen: 100 }],
    emitEvidencePins: false,
  });

  return { db, canonicalCandidateId: canonical.candidateId, duplicateCandidateId: duplicate.candidateId };
}

test("canonical duplicate audit rejects resolution evidence after append-only candidate semantics drift", () => {
  const { db, duplicateCandidateId } = fixture();
  try {
    const plan = planSourceDuplicateResolution(db);
    assert.equal(plan.plannedResolutions.length, 1);
    assert.equal(plan.valueConflicts.length, 0);
    assert.equal(applySourceDuplicateResolution(db, plan, NOW).inserted, 1);
    assert.equal(auditCanonicalDuplicates(db).activeDuplicateObservations, 0);

    db.prepare(`INSERT INTO race_payout_lines_v2
      (payout_line_id,candidate_id,line_no,bet_type,selection_raw,selection_normalized,selection_canonical,
       payout_yen,popularity,line_kind,created_at)
      VALUES (?,?,2,'win','1','1','1',999,NULL,'payout',?)`)
      .run("late-payout-line", duplicateCandidateId, NOW);

    assert.throws(
      () => auditCanonicalDuplicates(db),
      /SOURCE_DUPLICATE_RESOLUTION_EVIDENCE_INVALID:obs-duplicate/,
    );
  } finally {
    db.close();
  }
});
