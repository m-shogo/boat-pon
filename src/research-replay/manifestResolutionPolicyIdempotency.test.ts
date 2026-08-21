import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { canonicalHash } from "./canonical";
import { registerResolutionPolicies, RESOLUTION_POLICIES } from "./manifest";
import { initializeSidecarSchema, openSidecarDatabase } from "./schema";

function withSidecar(run: (db: ReturnType<typeof openSidecarDatabase>) => void): void {
  const root = mkdtempSync(join(tmpdir(), "boat-pon-resolution-policy-"));
  const db = openSidecarDatabase(join(root, "sidecar.sqlite"));
  try {
    initializeSidecarSchema(db, "2026-08-21T00:00:00.000Z");
    run(db);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
}

test("resolution policy registration reuses only the exact immutable policy body", () => {
  withSidecar((db) => {
    registerResolutionPolicies(db, "2026-08-21T00:00:00.000Z");
    registerResolutionPolicies(db, "2026-08-21T01:00:00.000Z");

    const rows = db.prepare("SELECT policy_version, created_at FROM asof_resolution_policies ORDER BY policy_version").all() as Array<{
      policy_version: string;
      created_at: string;
    }>;
    assert.equal(rows.length, Object.keys(RESOLUTION_POLICIES).length);
    assert.ok(rows.every((row) => row.created_at === "2026-08-21T00:00:00.000Z"));
  });
});

test("resolution policy registration rejects stale body hidden behind current policy version", () => {
  withSidecar((db) => {
    const policy = RESOLUTION_POLICIES.research_replay_strict_pre_race;
    db.prepare(`
      INSERT INTO asof_resolution_policies
      (policy_version, purpose, required_observation_types, optional_observation_types,
       source_priority, max_staleness_seconds, timestamp_unknown_policy, tie_break_policy,
       fallback_policy, forbidden_observation_types, content_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      policy.policyVersion,
      policy.purpose,
      JSON.stringify(policy.requiredObservationTypes),
      JSON.stringify(policy.optionalObservationTypes),
      JSON.stringify(policy.sourcePriority),
      policy.maxStalenessSeconds + 1,
      policy.timestampUnknownPolicy,
      policy.tieBreakPolicy,
      policy.fallbackPolicy,
      JSON.stringify(policy.forbiddenObservationTypes),
      canonicalHash(policy),
      "2026-08-20T00:00:00.000Z",
    );

    assert.throws(
      () => registerResolutionPolicies(db, "2026-08-21T00:00:00.000Z"),
      /RESOLUTION_POLICY_REGISTRATION_CONFLICT:rr-strict-pre-race-v1/,
    );

    const stored = db.prepare(`
      SELECT max_staleness_seconds FROM asof_resolution_policies WHERE policy_version=?
    `).get(policy.policyVersion) as { max_staleness_seconds: number };
    assert.equal(stored.max_staleness_seconds, policy.maxStalenessSeconds + 1);
  });
});
