import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FIXTURE_DIR, FIXTURE_RACE_KEY } from "./canary";
import { buildRaceAsOfManifest } from "./manifest";
import { RawStore } from "./rawStore";
import { ResearchReplayRepository, type FixtureEnvelope } from "./repository";
import { initializeSidecarSchema, openSidecarDatabase } from "./schema";

const AS_OF = "2026-07-24T06:15:00.000Z";

function fixtureEnvelope(name: string): FixtureEnvelope {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf8")) as FixtureEnvelope;
}

function withContext(run: (input: {
  db: ReturnType<typeof openSidecarDatabase>;
  repository: ResearchReplayRepository;
  setNow(value: string): void;
}) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-manifest-schedule-asof-"));
  const db = openSidecarDatabase(join(root, "sidecar.sqlite"));
  initializeSidecarSchema(db, "2026-07-24T00:00:00.000Z");
  let now = "2026-07-24T05:00:00.000Z";
  let id = 0;
  const repository = new ResearchReplayRepository(
    db,
    new RawStore(join(root, "raw")),
    () => `manifest-schedule-asof-${++id}`,
    () => now,
  );
  try {
    run({ db, repository, setNow(value) { now = value; } });
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
}

function recordEnvelope(input: {
  repository: ResearchReplayRepository;
  envelope: FixtureEnvelope;
  observationId?: string;
  supersedesObservationId?: string;
}): string {
  const raw = input.repository.recordRawDocument({
    bytes: Buffer.from(JSON.stringify(input.envelope), "utf8"),
    contentType: "application/json",
    charset: "utf-8",
  });
  const parsed = input.repository.parseFixtureEnvelope({
    rawDocumentId: raw.rawDocumentId,
    parserVersion: "rr-parser-manifest-schedule-asof-v1",
    observationId: input.observationId,
    supersedesObservationId: input.supersedesObservationId,
    correctionKind: input.supersedesObservationId ? "test_correction" : null,
    correctionReason: input.supersedesObservationId ? "test" : null,
  });
  assert.ok(parsed.observationId);
  return parsed.observationId;
}

function marketEnvelope(scheduleObservationId: string): FixtureEnvelope {
  const market = fixtureEnvelope("trifecta-market.json");
  return {
    ...market,
    payload: {
      ...(market.payload as Record<string, unknown>),
      scheduledCloseObservationId: scheduleObservationId,
    },
  };
}

function build(db: ReturnType<typeof openSidecarDatabase>, repository: ResearchReplayRepository) {
  return buildRaceAsOfManifest({
    db,
    repository,
    canonicalRaceKey: FIXTURE_RACE_KEY,
    asOfAt: AS_OF,
    purpose: "research_replay_strict_pre_race",
    gitCommitSha: "test-sha",
    sourceSnapshotId: "test-snapshot",
    persist: false,
    createdAt: AS_OF,
  });
}

function marketExpectation(result: ReturnType<typeof build>) {
  return result.expectations.find((item) => item.expectedObservationType === "trifecta_market");
}

test("manifest rejects a market whose referenced schedule was recorded after as-of", () => {
  withContext(({ db, repository, setNow }) => {
    recordEnvelope({
      repository,
      envelope: fixtureEnvelope("race-schedule.json"),
      observationId: "obs-schedule-current",
    });
    recordEnvelope({ repository, envelope: fixtureEnvelope("beforeinfo.json") });

    setNow(AS_OF);
    recordEnvelope({
      repository,
      envelope: marketEnvelope("obs-schedule-future"),
      observationId: "obs-market-future-reference",
    });

    setNow("2026-07-24T07:00:00.000Z");
    recordEnvelope({
      repository,
      envelope: fixtureEnvelope("race-schedule.json"),
      observationId: "obs-schedule-future",
    });

    const result = build(db, repository);
    assert.equal(marketExpectation(result)?.selectedObservationId, null);
    assert.equal(marketExpectation(result)?.rejectionCode, "SCHEDULE_VERSION_INVALID");
  });
});

test("manifest rejects a market that still references a schedule superseded by as-of", () => {
  withContext(({ db, repository, setNow }) => {
    const oldScheduleId = recordEnvelope({
      repository,
      envelope: fixtureEnvelope("race-schedule.json"),
      observationId: "obs-schedule-old",
    });
    recordEnvelope({ repository, envelope: fixtureEnvelope("beforeinfo.json") });

    setNow("2026-07-24T06:00:00.000Z");
    recordEnvelope({
      repository,
      envelope: fixtureEnvelope("race-schedule.json"),
      observationId: "obs-schedule-new",
      supersedesObservationId: oldScheduleId,
    });

    setNow(AS_OF);
    recordEnvelope({
      repository,
      envelope: marketEnvelope(oldScheduleId),
      observationId: "obs-market-stale-schedule-reference",
    });

    const result = build(db, repository);
    assert.equal(marketExpectation(result)?.selectedObservationId, null);
    assert.equal(marketExpectation(result)?.rejectionCode, "SCHEDULE_VERSION_INVALID");
  });
});
