import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const coreSource = readFileSync("scripts/report-paper-forward-candidates-core.ts", "utf-8");

test("paper-forward core redacts configured DB provenance after internal aggregation", () => {
  const preflight = coreSource.indexOf('run("scripts/audit-odds-payout-gap-completeness.ts")');
  const handoffIdentity = coreSource.indexOf("PAPER_FORWARD_CORE_DB_HANDOFF_IDENTITY_INVALID");
  const internal = coreSource.indexOf('run("scripts/report-paper-forward-candidates-internal.ts"');
  const redact = coreSource.lastIndexOf("redactDbProvenance(handoffDbPath)");

  assert.ok(preflight >= 0);
  assert.ok(handoffIdentity > preflight, "DB identity must be verified after settlement preflight");
  assert.ok(internal > handoffIdentity, "internal aggregation must receive only the verified DB handoff");
  assert.ok(redact > internal, "private DB provenance must be redacted after internal aggregation");
  assert.match(coreSource, /const OPAQUE_DB_SOURCE = "primary research database"/);
  assert.match(coreSource, /PAPER_FORWARD_CORE_PRIVATE_DB_PATH_REMAINS/);
  assert.match(coreSource, /writeFileSync\(OUT_MD, redacted, "utf-8"\)/);
});
