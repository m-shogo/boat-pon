import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";

const scriptPath = new URL("../../../scripts/report-runtime-decision-ledger-shadow.ts", import.meta.url);
const source = readFileSync(scriptPath, "utf8");

test("Runtime Decision Ledger shadow report is valid TypeScript syntax", () => {
  const result = transpileModule(source, {
    reportDiagnostics: true,
    compilerOptions: {
      module: ModuleKind.ESNext,
      target: ScriptTarget.ES2022,
    },
  });
  const errors = (result.diagnostics ?? []).filter((diagnostic) => diagnostic.category === 1);
  assert.deepEqual(errors.map((diagnostic) => diagnostic.messageText), []);
});

test("Runtime Decision Ledger shadow report opens SQLite read-only and query-only", () => {
  assert.match(source, /new DatabaseSync\(args\.dbPath, \{ readOnly: true \}\)/);
  assert.match(source, /PRAGMA query_only = ON/);
  assert.doesNotMatch(source, /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|CREATE\s+TABLE)\b/i);

  const forbiddenTokens = [
    "sendLine",
    "notify-line",
    ["app", "settings"].join("_"),
    "Cloudflare",
    "wrangler",
  ];
  for (const token of forbiddenTokens) assert.equal(source.includes(token), false, `forbidden dependency marker: ${token}`);
});

test("bounded evidence is finite, quiescent and excludes outcome/delivery columns", () => {
  assert.match(source, /bounded evidence requires both --from and --to/);
  assert.match(source, /bounded evidence requires --limit <= 5000/);
  assert.match(source, /bounded evidence refused: active SQLite WAL/);
  assert.match(source, /params\.push\(args\.limit \+ 1\)/);
  assert.match(source, /fetched\.slice\(0, args\.limit\)/);
  assert.doesNotMatch(source, /dh\.(?:result|payout_yen|actually_bought|stake_yen)\b/);
  assert.equal(source.includes("notification_log"), false);
});

test("private evidence store delegates append-only safety to the hardened store", () => {
  assert.match(source, /import \{ appendPrivateJsonStore \} from "\.\.\/src\/research\/governance\/privateAppendOnlyJsonStore"/);
  assert.match(source, /appendPrivateJsonStore\(\{/);
  assert.match(source, /expectedEvidenceDigest: evidence\.contentDigest/);
  assert.match(source, /validateExistingEvidence: \(value\) => validateRuntimeDecisionLedgerShadowEvidence\(value\)\.valid/);
  assert.match(source, /sourceDescriptorDigest\.slice\(0, 12\)/);
  assert.match(source, /contentDigest\.slice\(0, 12\)/);
  assert.doesNotMatch(source, /readFileSync\(path, "utf8"\)/);
});
