import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/report-racer-ability-audit.ts", "utf8");

test("racer ability audit revalidates DB and copied candidates immediately before internal spawn", () => {
  assert.match(source, /RACER_ABILITY_AUDIT_DB_HANDOFF_IDENTITY_INVALID/);
  assert.match(source, /RACER_ABILITY_AUDIT_CANDIDATES_HANDOFF_IDENTITY_INVALID/);

  const initialCandidateIdentity = source.indexOf("RACER_ABILITY_AUDIT_CANDIDATES_IDENTITY_INVALID");
  const candidateCopy = source.indexOf("copyFileSync(verifiedCandidatesPath, workspaceCandidates)");
  const dbHandoffIdentity = source.indexOf("RACER_ABILITY_AUDIT_DB_HANDOFF_IDENTITY_INVALID");
  const candidateHandoffIdentity = source.indexOf("RACER_ABILITY_AUDIT_CANDIDATES_HANDOFF_IDENTITY_INVALID");
  const spawn = source.indexOf("const child = spawnSync");

  assert.ok(initialCandidateIdentity >= 0);
  assert.ok(candidateCopy > initialCandidateIdentity);
  assert.ok(dbHandoffIdentity > candidateCopy);
  assert.ok(candidateHandoffIdentity > dbHandoffIdentity);
  assert.ok(spawn > candidateHandoffIdentity);
  assert.match(source, /BOAT_PON_DB_PATH: handoffDbPath/);
});
