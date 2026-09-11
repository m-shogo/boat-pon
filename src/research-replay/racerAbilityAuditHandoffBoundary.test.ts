import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/report-racer-ability-audit.ts", "utf8");

test("racer ability audit revalidates DB and candidates at the isolated handoff", () => {
  assert.match(source, /RACER_ABILITY_AUDIT_CANDIDATES_SOURCE_HANDOFF_IDENTITY_INVALID/);
  assert.match(source, /RACER_ABILITY_AUDIT_DB_HANDOFF_IDENTITY_INVALID/);
  assert.match(source, /RACER_ABILITY_AUDIT_CANDIDATES_HANDOFF_IDENTITY_INVALID/);
  assert.match(source, /RACER_ABILITY_AUDIT_DB_CHILD_HANDOFF_IDENTITY_INVALID/);
  assert.match(source, /RACER_ABILITY_AUDIT_CANDIDATES_CHILD_HANDOFF_IDENTITY_INVALID/);

  const initialCandidateIdentity = source.indexOf("RACER_ABILITY_AUDIT_CANDIDATES_IDENTITY_INVALID");
  const candidateSourceHandoffIdentity = source.indexOf("RACER_ABILITY_AUDIT_CANDIDATES_SOURCE_HANDOFF_IDENTITY_INVALID");
  const candidateCopy = source.indexOf("copyFileSync(handoffCandidatesSourcePath, workspaceCandidates)");
  const dbHandoffIdentity = source.indexOf("RACER_ABILITY_AUDIT_DB_HANDOFF_IDENTITY_INVALID");
  const candidateHandoffIdentity = source.indexOf("RACER_ABILITY_AUDIT_CANDIDATES_HANDOFF_IDENTITY_INVALID");
  const dbChildHandoffIdentity = source.indexOf("RACER_ABILITY_AUDIT_DB_CHILD_HANDOFF_IDENTITY_INVALID");
  const candidateChildHandoffIdentity = source.indexOf("RACER_ABILITY_AUDIT_CANDIDATES_CHILD_HANDOFF_IDENTITY_INVALID");
  const spawn = source.indexOf("const child = spawnSync");

  assert.ok(initialCandidateIdentity >= 0);
  assert.ok(candidateSourceHandoffIdentity > initialCandidateIdentity);
  assert.ok(candidateCopy > candidateSourceHandoffIdentity);
  assert.ok(dbHandoffIdentity > candidateCopy);
  assert.ok(candidateHandoffIdentity > dbHandoffIdentity);
  assert.ok(dbChildHandoffIdentity > candidateHandoffIdentity);
  assert.ok(candidateChildHandoffIdentity > dbChildHandoffIdentity);
  assert.ok(spawn > candidateChildHandoffIdentity);
  assert.match(source, /BOAT_PON_DB_PATH: childDbPath/);
});
