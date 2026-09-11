import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/analyze-racer-relationship-market.ts", "utf8");

test("racer relationship market analysis verifies official registry identity before parsing", () => {
  const identity = source.indexOf("OFFICIAL_RACER_RELATIONSHIP_REGISTRY_IDENTITY_INVALID");
  const parse = source.indexOf('JSON.parse(readFileSync(verifiedOfficialRegistryPath, "utf8"))');

  assert.match(source, /assertCanonicalSingleLinkRegularFile/u);
  assert.ok(identity >= 0, "registry identity error code must exist");
  assert.ok(parse > identity, "registry identity must be verified before parsing");
  assert.doesNotMatch(
    source,
    /JSON\.parse\(readFileSync\("docs\/official-racer-relationships\.json", "utf8"\)\)/u,
  );
});
