import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { recordApprovalGrant } from "./approval";
import {
  applyOfficialProgramCanary,
  buildOfficialProgramCanaryManifest,
  officialProgramCanaryApprovalTarget,
  type OfficialProgramCanarySourceRow,
} from "./n2OfficialProgramCanary";
import {
  buildOfficialProgramObservationEnvelope,
  N2_OFFICIAL_PROGRAM_PARSER_VERSION,
  N2_OFFICIAL_PROGRAM_SOURCE_SCHEMA_VERSION,
} from "./n2OfficialProgramObservation";
import { RawStore } from "./rawStore";
import { ResearchReplayRepository } from "./repository";
import { initializeRolloutSchema, openRolloutDatabase } from "./schema";

const CODE_SHA = "1234567890abcdef1234567890abcdef12345678";

function raw(): string {
  return JSON.stringify({
    boats: Array.from({ length: 6 }, (_, index) => ({
      course: index + 1,
      registrationNo: String(4000 + index),
      className: index === 0 ? "A1" : "B1",
      nationalWinRate: 6 + index / 10,
      nationalTop2Rate: 40 + index,
      localWinRate: 5 + index / 10,
      localTop2Rate: 35 + index,
      motorTop2Rate: 30 + index,
      boatTop2Rate: 28 + index,
    })),
  });
}

function sourceRow(): OfficialProgramCanarySourceRow {
  return {
    raceId: "20040101-01-01",
    date: "2004-01-01",
    venue: "桐生",
    raceNo: 1,
    closeAt: "23:00",
    sourceFile: "/private/cache/2004-01-01-01-1.json",
    rawJson: raw(),
    importedAt: "2004-01-01 01:00:00",
  };
}

function runCase(mutateRaw: (db: ReturnType<typeof openRolloutDatabase>, rawDocumentId: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "n2-program-canary-raw-eligibility-"));
  const db = openRolloutDatabase(join(dir, "sidecar.sqlite"));
  initializeRolloutSchema(db, "2004-01-01T00:00:00.000Z");
  let sequence = 0;
  const repository = new ResearchReplayRepository(
    db,
    new RawStore(join(dir, "raw")),
    () => `raw-eligibility-${++sequence}`,
    () => "2004-01-01T01:00:00.000Z",
  );

  try {
    const row = sourceRow();
    const manifest = buildOfficialProgramCanaryManifest({
      rows: [row],
      cohort: { dateFrom: "2004-01-01", dateTo: "2004-01-07" },
      codeGitSha: CODE_SHA,
      generatedAt: "2004-01-08T00:00:00.000Z",
    });
    const item = manifest.binding.items[0];
    const storedRaw = repository.recordRawDocument({
      bytes: Buffer.from(row.rawJson, "utf8"),
      contentType: "application/json",
      charset: "utf-8",
      retentionClass: "research_evidence",
    });
    const current = repository.parseTypedRawDocument({
      rawDocumentId: storedRaw.rawDocumentId,
      parserName: "n2-official-program",
      parserVersion: N2_OFFICIAL_PROGRAM_PARSER_VERSION,
      expectedSourceSchemaVersion: N2_OFFICIAL_PROGRAM_SOURCE_SCHEMA_VERSION,
      parse: (bytes) => buildOfficialProgramObservationEnvelope({
        canonicalRaceKey: item.canonicalRaceKey,
        rawJson: bytes.toString("utf8"),
        sourcePublishedAt: null,
        sourceObservedAt: item.sourceObservedAt,
        firstSeenAt: item.sourceObservedAt,
      }),
    });
    assert.ok(current.observationId);
    mutateRaw(db, storedRaw.rawDocumentId);

    recordApprovalGrant(db, {
      approvalId: "approval-raw-eligibility",
      ...officialProgramCanaryApprovalTarget(manifest.manifestDigest),
      approvalSource: "human",
      approvalReference: "test://approval-raw-eligibility",
      approvedAt: "2004-01-01T00:45:00Z",
      approvalMode: "production",
    }, "2004-01-01T01:00:00.000Z");

    assert.throws(() => applyOfficialProgramCanary({
      db,
      repository,
      manifest,
      primaryRows: [row],
      gateInput: {
        executionMode: "production",
        rolloutStartedAt: "2004-01-01T02:00:00.000Z",
        onDisk: {
          codeGitSha: CODE_SHA,
          hasActiveWal: false,
          diskFreeBytes: Number.MAX_SAFE_INTEGER,
          neededBytes: 1,
          shadowWriteEnabled: false,
          killSwitchEngaged: false,
        },
      },
    }), /CANARY_RAW_DOCUMENT_INELIGIBLE/u);

    assert.equal((db.prepare("SELECT COUNT(*) n FROM capture_attempts").get() as { n: number }).n, 0);
    assert.equal((db.prepare("SELECT COUNT(*) n FROM domain_observations").get() as { n: number }).n, 1);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

test("canary refuses a current observation backed by quarantined raw evidence", () => {
  runCase((db, rawDocumentId) => {
    db.prepare("UPDATE raw_documents SET integrity_status='quarantined' WHERE raw_document_id=?").run(rawDocumentId);
  });
});

test("canary refuses a current observation backed by security-quarantined raw evidence", () => {
  runCase((db, rawDocumentId) => {
    db.prepare("UPDATE raw_documents SET security_scan_status='quarantined' WHERE raw_document_id=?").run(rawDocumentId);
  });
});

test("canary refuses a current observation backed by replay-ineligible raw evidence", () => {
  runCase((db, rawDocumentId) => {
    db.prepare("UPDATE raw_documents SET parser_replay_eligible=0 WHERE raw_document_id=?").run(rawDocumentId);
  });
});
