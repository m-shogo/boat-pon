import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("scripts/audit-historical-closing-odds-availability-internal.ts", "utf8");

test("historical closing-odds condB classification cannot multiply candidate races", () => {
  const cbStart = source.indexOf("cb AS (");
  const candidateSelect = source.indexOf("SELECT f.race_id", cbStart);
  const cb = source.slice(cbStart, candidateSelect);

  assert.ok(cbStart >= 0, "condB CTE must exist");
  assert.ok(candidateSelect > cbStart, "candidate select must follow condB CTE");
  assert.match(cb, /SELECT DISTINCT dh\.race_id/u);
  assert.match(source, /LEFT JOIN cb ON cb\.race_id=f\.race_id/u);
});
