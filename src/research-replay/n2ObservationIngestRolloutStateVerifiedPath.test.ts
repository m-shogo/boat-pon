import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("rollout state opens the exact lexical sidecar path that passed identity validation", () => {
  const source = readFileSync(new URL("./n2ObservationIngestRolloutState.ts", import.meta.url), "utf8");
  assert.match(source, /const lexicalPath = assertSidecarIdentity\(sidecarDbPath\);/u);
  assert.match(source, /pathToFileURL\(lexicalPath\)/u);
  assert.doesNotMatch(source, /pathToFileURL\(sidecarDbPath\)/u);
});
