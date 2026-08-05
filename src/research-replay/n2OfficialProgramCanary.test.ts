import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { recordApprovalGrant } from "./approval";
import {
  applyOfficialProgramCanary,
  assertOfficialProgramCanaryManifest,
  buildOfficialProgramCanaryManifest,
  N2_OFFICIAL_PROGRAM_CANARY_MAX_RACES,
  officialProgramCanaryApprovalTarget,
  resolveOfficialProgramCanaryGate,
  type OfficialProgramCanaryManifest,
  type OfficialProgramCanarySourceRow,
} from "./n2OfficialProgramCanary";
import { RawStore } from "./rawStore";
import { ResearchReplayRepository } from "./repository";
import { initializeRolloutSchema, openRolloutDatabase } from "./schema";

const CODE_SHA = "1234567890abcdef1234567890abcdef12345678";
const COHORT = { dateFrom: "2004-01-01", dateTo: "2004-01-07" } as const;

function raw(rate = 6): string {
  return JSON.stringify({
    boats: Array.from({ length: 6 }, (_, index) => ({
      course: index + 1,
      registrationNo: String(4000 + index),
      className: index === 0 ? "A1" : "B1",
      nationalWinRate: rate + index / 10,
      nationalTop2Rate: 40 + index,
      localWinRate: 5 + index / 10,
      localTop2Rate: 35 + index,
      motorTop2Rate: 30 + index,
      boatTop2Rate: 28 + index,
    })),
  });
}

function row(input: {
  date?: string;
  venue?: string;
  venueCode?: string;
  raceNo?: number;
  importedAt?: string;
  closeAt?: string;
  rawJson?: string;
  sourceFile?: string;
} = {}): OfficialProgramCanarySourceRow {
  const date = input.date ?? "2004-01-01";
  const venue = input.venue ?? "桐生";
  const venueCode = input.venueCode ?? "01";
  const raceNo = input.raceNo ?? 1;
  return {
    raceId: `${date.replaceAll("-", "")}-${venueCode}-${String(raceNo).padStart(2, "0")}`,
    date,
    venue,
    raceNo,
    closeAt: input.closeAt ?? "23:00",
    sourceFile: input.sourceFile ?? `/private/cache/${date}-${venueCode}-${raceNo}.json`,
    rawJson: input.rawJson ?? raw(),
    importedAt: input.importedAt ?? `${date} 01:00:00`,
  };
}

function context() {
  const dir = mkdtempSync(join(tmpdir(), "n2-program-canary-"));
  const db = openRolloutDatabase(join(dir, "sidecar.sqlite"));
  initializeRolloutSchema(db, "2004-01-01T00:00:00.000Z");
  let sequence = 0;
  const clock = () => "2004-01-01T01:00:00.000Z";
  const repository = new ResearchReplayRepository(
    db,
    new RawStore(join(dir, "raw")),
    () => `canary-${++sequence}`,
    clock,
  );
  return {
    dir,
    db,
    repository,
    close() {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function manifest(rows: OfficialProgramCanarySourceRow[], maxRaces = 20): OfficialProgramCanaryManifest {
  return buildOfficialProgramCanaryManifest({
    rows,
    cohort: COHORT,
    maxRaces,
    codeGitSha: CODE_SHA,
    generatedAt: "2004-01-08T00:00:00.000Z",
  });
}

function gateInput(value: OfficialProgramCanaryManifest, overrides: Partial<{
  executionMode: "production" | "simulated";
  hasActiveWal: boolean;
  shadowWriteEnabled: boolean;
  killSwitchEngaged: boolean;
  codeGitSha: string | null;
}> = {}) {
  return {
    manifest: value,
    executionMode: overrides.executionMode ?? "production",
    rolloutStartedAt: "2004-01-01T02:00:00.000Z",
    onDisk: {
      codeGitSha: overrides.codeGitSha === undefined ? CODE_SHA : overrides.codeGitSha,
      hasActiveWal: overrides.hasActiveWal ?? false,
      diskFreeBytes: Number.MAX_SAFE_INTEGER,
      neededBytes: 1,
      shadowWriteEnabled: overrides.shadowWriteEnabled ?? false,
      killSwitchEngaged: overrides.killSwitchEngaged ?? false,
    },
  } as const;
}

function approve(db: ReturnType<typeof openRolloutDatabase>, value: OfficialProgramCanaryManifest, input: {
  id: string;
  mode: "production" | "simulated";
  approvedAt: string;
}) {
  recordApprovalGrant(db, {
    approvalId: input.id,
    ...officialProgramCanaryApprovalTarget(value.manifestDigest),
    approvalSource: "human",
    approvalReference: `test://${input.id}`,
    approvedAt: input.approvedAt,
    approvalMode: input.mode,
  }, "2004-01-01T01:00:00.000Z");
}

test("manifest deterministically binds the source universe and selects at most 20 races", () => {
  const rows: OfficialProgramCanarySourceRow[] = [];
  for (let index = 0; index < 23; index += 1) {
    const venue = index < 12 ? "桐生" : "戸田";
    const venueCode = index < 12 ? "01" : "02";
    const raceNo = (index % 12) + 1;
    rows.push(row({ venue, venueCode, raceNo, rawJson: raw(6 + index / 100) }));
  }
  rows.push(row({
    venue: "江戸川",
    venueCode: "03",
    raceNo: 1,
    importedAt: "2004-01-01 23:00:00",
    closeAt: "22:59",
  }));

  const first = manifest(rows);
  const reordered = manifest([...rows].reverse());
  assert.equal(first.manifestDigest, reordered.manifestDigest);
  assert.equal(first.binding.sourceRowCount, 24);
  assert.equal(first.binding.eligibleRowCount, 23);
  assert.equal(first.binding.excludedCount, 1);
  assert.equal(first.binding.items.length, N2_OFFICIAL_PROGRAM_CANARY_MAX_RACES);
  assert.equal(first.excluded[0].reason, "POST_CUTOFF_PRIMARY_IMPORT");
  assert.doesNotThrow(() => assertOfficialProgramCanaryManifest(first));
  const serialized = JSON.stringify(first);
  assert.equal(serialized.includes("rawJson"), false);
  assert.equal(serialized.includes("/private/cache"), false);
});

test("truncated source reads, oversized cohorts and exclusion tampering fail closed", () => {
  assert.throws(() => buildOfficialProgramCanaryManifest({
    rows: [row()],
    cohort: COHORT,
    sourceReadTruncated: true,
    codeGitSha: CODE_SHA,
    generatedAt: "2004-01-08T00:00:00Z",
  }), /CANARY_SOURCE_READ_TRUNCATED/);
  assert.throws(() => manifest([row()], 21), /INVALID_CANARY_MAX_RACES/);

  const value = manifest([row()]);
  const tampered = structuredClone(value);
  tampered.excluded.push({ primaryRecordId: "fake", reason: "fake" });
  assert.throws(() => assertOfficialProgramCanaryManifest(tampered), /COUNT_MISMATCH|EXCLUSION_DIGEST/);
});

test("missing or simulated approval and runtime hazards block before any sidecar write", () => {
  const ctx = context();
  try {
    const rows = [row()];
    const value = manifest(rows);
    const missing = resolveOfficialProgramCanaryGate(ctx.db, gateInput(value));
    assert.equal(missing.approved, false);
    assert.ok(missing.blocks.includes("APPROVAL_HUMAN_APPROVAL_MISSING"));
    assert.throws(() => applyOfficialProgramCanary({
      db: ctx.db,
      repository: ctx.repository,
      manifest: value,
      primaryRows: rows,
      gate: missing,
    }), /CANARY_GATE_NOT_APPROVED/);

    approve(ctx.db, value, {
      id: "approval-simulated",
      mode: "simulated",
      approvedAt: "2004-01-01T00:30:00Z",
    });
    const simulated = resolveOfficialProgramCanaryGate(ctx.db, gateInput(value));
    assert.ok(simulated.blocks.includes("APPROVAL_SIMULATED_APPROVAL_NOT_PRODUCTION"));

    const hazardous = resolveOfficialProgramCanaryGate(ctx.db, gateInput(value, {
      hasActiveWal: true,
      shadowWriteEnabled: true,
      killSwitchEngaged: true,
      codeGitSha: "abcdef1",
    }));
    assert.ok(hazardous.blocks.includes("ACTIVE_WAL"));
    assert.ok(hazardous.blocks.includes("GLOBAL_SHADOW_WRITE_MUST_REMAIN_DISABLED"));
    assert.ok(hazardous.blocks.includes("KILL_SWITCH_ENGAGED"));
    assert.ok(hazardous.blocks.includes("CODE_SHA_MISMATCH"));
    assert.equal((ctx.db.prepare("SELECT COUNT(*) n FROM domain_observations").get() as { n: number }).n, 0);
    assert.equal((ctx.db.prepare("SELECT COUNT(*) n FROM capture_attempts").get() as { n: number }).n, 0);
  } finally {
    ctx.close();
  }
});

test("exact production approval permits a bounded existing-cache capture and replay is idempotent", () => {
  const ctx = context();
  try {
    const rows = [row()];
    const value = manifest(rows);
    approve(ctx.db, value, {
      id: "approval-production",
      mode: "production",
      approvedAt: "2004-01-01T00:45:00Z",
    });
    const gate = resolveOfficialProgramCanaryGate(ctx.db, gateInput(value));
    assert.equal(gate.approved, true);
    assert.equal(gate.status, "PASS");

    const first = applyOfficialProgramCanary({
      db: ctx.db,
      repository: ctx.repository,
      manifest: value,
      primaryRows: rows,
      gate,
    });
    assert.deepEqual(first, {
      manifestDigest: value.manifestDigest,
      selectedCount: 1,
      insertedCount: 1,
      reusedCount: 0,
      primaryWriteCount: 0,
      sidecarWriteAuthorized: true,
      globalShadowWriteEnabled: false,
    });
    const capture = ctx.db.prepare("SELECT method, source_type FROM capture_attempts").get() as {
      method: string;
      source_type: string;
    };
    assert.equal(capture.method, "EXISTING_CACHE");
    assert.equal(capture.source_type, "official_program");
    const observation = ctx.db.prepare(`
      SELECT observation_type, source_published_at, timing_quality, source_quality
      FROM domain_observations
    `).get() as {
      observation_type: string;
      source_published_at: string | null;
      timing_quality: string;
      source_quality: string;
    };
    assert.equal(observation.observation_type, "official_program");
    assert.equal(observation.source_published_at, null);
    assert.equal(observation.timing_quality, "observed_only");
    assert.equal(observation.source_quality, "official_public");

    const replay = applyOfficialProgramCanary({
      db: ctx.db,
      repository: ctx.repository,
      manifest: value,
      primaryRows: rows,
      gate,
    });
    assert.equal(replay.insertedCount, 0);
    assert.equal(replay.reusedCount, 1);
    assert.equal((ctx.db.prepare("SELECT COUNT(*) n FROM domain_observations").get() as { n: number }).n, 1);
    assert.equal((ctx.db.prepare("SELECT COUNT(*) n FROM capture_attempts").get() as { n: number }).n, 1);
  } finally {
    ctx.close();
  }
});

test("primary raw drift is rejected before capture evidence is written", () => {
  const ctx = context();
  try {
    const rows = [row()];
    const value = manifest(rows);
    approve(ctx.db, value, {
      id: "approval-drift",
      mode: "production",
      approvedAt: "2004-01-01T00:45:00Z",
    });
    const gate = resolveOfficialProgramCanaryGate(ctx.db, gateInput(value));
    assert.equal(gate.approved, true);
    const drifted = [{ ...rows[0], rawJson: raw(7) }];
    assert.throws(() => applyOfficialProgramCanary({
      db: ctx.db,
      repository: ctx.repository,
      manifest: value,
      primaryRows: drifted,
      gate,
    }), /PRIMARY_ROW_DRIFT/);
    assert.equal((ctx.db.prepare("SELECT COUNT(*) n FROM domain_observations").get() as { n: number }).n, 0);
    assert.equal((ctx.db.prepare("SELECT COUNT(*) n FROM capture_attempts").get() as { n: number }).n, 0);
  } finally {
    ctx.close();
  }
});
