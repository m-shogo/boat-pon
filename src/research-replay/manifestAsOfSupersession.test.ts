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

function fixtureEnvelope(name: string): FixtureEnvelope {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf8")) as FixtureEnvelope;
}

function withContext(run: (input: {
  db: ReturnType<typeof openSidecarDatabase>;
  repository: ResearchReplayRepository;
  setNow(value: string): void;
}) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-manifest-supersession-"));
  const db = openSidecarDatabase(join(root, "sidecar.sqlite"));
  initializeSidecarSchema(db, "2026-07-24T00:00:00.000Z");
  let now = "2026-07-24T05:00:00.000Z";
  let id = 0;
  const repository = new ResearchReplayRepository(
    db,
    new RawStore(join(root, "raw")),
    () => `manifest-supersession-${++id}`,
    () => now,
  );
  try {
    run({ db, repository, setNow(value) { now = value; } });
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
}

function recordBeforeinfo(input: {
  repository: ResearchReplayRepository;
  envelope: FixtureEnvelope;
  supersedesObservationId?: string;
}): string {
  const raw = input.repository.recordRawDocument({
    bytes: Buffer.from(JSON.stringify(input.envelope), "utf8"),
    contentType: "application/json",
    charset: "utf-8",
  });
  const parsed = input.repository.parseFixtureEnvelope({
    rawDocumentId: raw.rawDocumentId,
    parserVersion: "rr-parser-manifest-supersession-v1",
    supersedesObservationId: input.supersedesObservationId,
    correctionKind: input.supersedesObservationId ? "test_correction" : null,
    correctionReason: input.supersedesObservationId ? "test" : null,
  });
  assert.ok(parsed.observationId);
  return parsed.observationId;
}

function build(db: ReturnType<typeof openSidecarDatabase>, repository: ResearchReplayRepository) {
  return buildRaceAsOfManifest({
    db,
    repository,
    canonicalRaceKey: FIXTURE_RACE_KEY,
    asOfAt: "2026-07-24T06:15:00.000Z",
    purpose: "research_replay_strict_pre_race",
    gitCommitSha: "test-sha",
    sourceSnapshotId: "test-snapshot",
    persist: false,
    createdAt: "2026-07-24T06:15:00.000Z",
  });
}

test("future-recorded correction does not rewrite an earlier as-of manifest", () => {
  withContext(({ db, repository, setNow }) => {
    const baseline = fixtureEnvelope("beforeinfo.json");
    const originalId = recordBeforeinfo({ repository, envelope: baseline });

    setNow("2026-07-24T07:00:00.000Z");
    recordBeforeinfo({
      repository,
      envelope: {
        ...baseline,
        sourceObservedAt: "2026-07-24T05:10:00.000Z",
        firstSeenAt: "2026-07-24T05:10:00.000Z",
      },
      supersedesObservationId: originalId,
    });

    const manifest = build(db, repository);
    assert.equal(
      manifest.expectations.find((item) => item.expectedObservationType === "beforeinfo")?.selectedObservationId,
      originalId,
    );
  });
});

test("correction known by as-of suppresses the superseded predecessor", () => {
  withContext(({ db, repository, setNow }) => {
    const baseline = fixtureEnvelope("beforeinfo.json");
    const originalId = recordBeforeinfo({
      repository,
      envelope: {
        ...baseline,
        sourceObservedAt: "2026-07-24T05:10:00.000Z",
        firstSeenAt: "2026-07-24T05:10:00.000Z",
      },
    });

    setNow("2026-07-24T06:00:00.000Z");
    const correctionId = recordBeforeinfo({
      repository,
      envelope: {
        ...baseline,
        sourceObservedAt: "2026-07-24T05:00:00.000Z",
        firstSeenAt: "2026-07-24T05:00:00.000Z",
      },
      supersedesObservationId: originalId,
    });

    const manifest = build(db, repository);
    assert.equal(
      manifest.expectations.find((item) => item.expectedObservationType === "beforeinfo")?.selectedObservationId,
      correctionId,
    );
  });
});
