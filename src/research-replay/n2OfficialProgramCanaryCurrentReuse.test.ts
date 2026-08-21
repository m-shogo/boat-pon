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
const STALE_PARSER_VERSION = "n2-official-program-parser-v0";

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

test("stale parser observation does not suppress the current canary parse contract", () => {
  const dir = mkdtempSync(join(tmpdir(), "n2-program-canary-current-reuse-"));
  const db = openRolloutDatabase(join(dir, "sidecar.sqlite"));
  initializeRolloutSchema(db, "2004-01-01T00:00:00.000Z");
  let sequence = 0;
  const repository = new ResearchReplayRepository(
    db,
    new RawStore(join(dir, "raw")),
    () => `reuse-${++sequence}`,
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
    const stale = repository.parseTypedRawDocument({
      rawDocumentId: storedRaw.rawDocumentId,
      parserName: "n2-official-program",
      parserVersion: STALE_PARSER_VERSION,
      expectedSourceSchemaVersion: N2_OFFICIAL_PROGRAM_SOURCE_SCHEMA_VERSION,
      parse: (bytes) => buildOfficialProgramObservationEnvelope({
        canonicalRaceKey: item.canonicalRaceKey,
        rawJson: bytes.toString("utf8"),
        sourcePublishedAt: null,
        sourceObservedAt: item.sourceObservedAt,
        firstSeenAt: item.sourceObservedAt,
      }),
    });
    assert.ok(stale.observationId);

    recordApprovalGrant(db, {
      approvalId: "approval-current-parser",
      ...officialProgramCanaryApprovalTarget(manifest.manifestDigest),
      approvalSource: "human",
      approvalReference: "test://approval-current-parser",
      approvedAt: "2004-01-01T00:45:00Z",
      approvalMode: "production",
    }, "2004-01-01T01:00:00.000Z");

    const applied = applyOfficialProgramCanary({
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
    });

    assert.equal(applied.insertedCount, 1);
    assert.equal(applied.reusedCount, 0);
    assert.equal((db.prepare("SELECT COUNT(*) n FROM capture_attempts").get() as { n: number }).n, 1);
    assert.equal((db.prepare("SELECT COUNT(*) n FROM domain_observations").get() as { n: number }).n, 2);

    const parserVersions = (db.prepare(`
      SELECT DISTINCT p.parser_version AS parserVersion
      FROM parse_runs p
      JOIN domain_observations o ON o.parse_run_id=p.parse_run_id
      WHERE o.canonical_race_key=? AND o.observation_type='official_program'
      ORDER BY p.parser_version
    `).all(item.canonicalRaceKey) as unknown as Array<{ parserVersion: string }>).map((entry) => entry.parserVersion);
    assert.deepEqual(parserVersions, [STALE_PARSER_VERSION, N2_OFFICIAL_PROGRAM_PARSER_VERSION].sort());
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
