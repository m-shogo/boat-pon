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
const RECENT = "2026-07-24T06:14:00.000Z";
const FUTURE = "2026-07-24T06:16:00.000Z";

function fixtureEnvelope(name: string): FixtureEnvelope {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf8")) as FixtureEnvelope;
}

function withContext(run: (input: {
  db: ReturnType<typeof openSidecarDatabase>;
  repository: ResearchReplayRepository;
}) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-manifest-schedule-timing-"));
  const db = openSidecarDatabase(join(root, "sidecar.sqlite"));
  initializeSidecarSchema(db, "2026-07-24T00:00:00.000Z");
  let id = 0;
  const repository = new ResearchReplayRepository(
    db,
    new RawStore(join(root, "raw")),
    () => `manifest-schedule-timing-${++id}`,
    () => AS_OF,
  );
  try {
    run({ db, repository });
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
}

function record(input: {
  repository: ResearchReplayRepository;
  envelope: FixtureEnvelope;
  observationId?: string;
}): string {
  const raw = input.repository.recordRawDocument({
    bytes: Buffer.from(JSON.stringify(input.envelope), "utf8"),
    contentType: "application/json",
    charset: "utf-8",
  });
  const parsed = input.repository.parseFixtureEnvelope({
    rawDocumentId: raw.rawDocumentId,
    parserVersion: "rr-parser-manifest-schedule-timing-v1",
    observationId: input.observationId,
  });
  assert.ok(parsed.observationId);
  return parsed.observationId;
}

test("manifest rejects a market bound to a schedule whose source timing is after as-of", () => {
  withContext(({ db, repository }) => {
    const schedule = fixtureEnvelope("race-schedule.json");
    record({
      repository,
      envelope: {
        ...schedule,
        sourcePublishedAt: RECENT,
        sourceObservedAt: RECENT,
        firstSeenAt: RECENT,
        sourceQuality: "official_public",
      },
      observationId: "obs-schedule-current",
    });

    const beforeinfo = fixtureEnvelope("beforeinfo.json");
    record({
      repository,
      envelope: { ...beforeinfo, sourceQuality: "official_public" },
    });

    record({
      repository,
      envelope: {
        ...schedule,
        sourcePublishedAt: FUTURE,
        sourceObservedAt: FUTURE,
        firstSeenAt: FUTURE,
        sourceQuality: "official_public",
      },
      observationId: "obs-schedule-future-source",
    });

    const market = fixtureEnvelope("trifecta-market.json");
    record({
      repository,
      envelope: {
        ...market,
        sourceQuality: "official_public",
        payload: {
          ...(market.payload as Record<string, unknown>),
          scheduledCloseObservationId: "obs-schedule-future-source",
        },
      },
      observationId: "obs-market-future-source-schedule",
    });

    const result = buildRaceAsOfManifest({
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

    const marketExpectation = result.expectations.find((item) => item.expectedObservationType === "trifecta_market");
    assert.equal(marketExpectation?.selectedObservationId, null);
    assert.equal(marketExpectation?.rejectionCode, "SCHEDULE_VERSION_INVALID");
  });
});
