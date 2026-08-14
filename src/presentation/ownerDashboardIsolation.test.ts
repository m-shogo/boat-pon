import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const FILES = [
  "src/components/OwnerDashboardSummary.tsx",
  "src/components/useOwnerDashboardSnapshot.ts",
  "src/presentation/ownerDashboardBuilder.ts",
  "src/presentation/ownerDashboardSnapshot.ts",
  "scripts/export-owner-dashboard-snapshot.ts",
];

test("owner dashboard lane is read-only and production isolated", async () => {
  const source = (await Promise.all(FILES.map((file) => readFile(file, "utf8")))).join("\n");
  assert.doesNotMatch(source, /\b(?:POST|PUT|PATCH|DELETE)\b/);
  assert.doesNotMatch(source, /app_settings|notify-line|notificationWriter|better-sqlite3|sqlite3|\/api\/owner|\/api\/dashboard/i);
  assert.doesNotMatch(source, /automation\/requests|src\/decision|src\/production|server\/db/i);
  assert.match(source, /no-store/);
});

test("owner dashboard does not contain activation or attempt mutation paths", async () => {
  const source = (await Promise.all(FILES.map((file) => readFile(file, "utf8")))).join("\n");
  assert.doesNotMatch(source, /attemptCount\s*[+\-]=|attemptCount\s*=\s*attemptCount\s*[+\-]/);
  assert.doesNotMatch(source, /activateTask|dispatchTask|writeQueue|updateQueue|persistDecision/i);
});
