import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const BROWSER_FILES = [
  "src/components/OwnerDashboardSummary.tsx",
  "src/components/useOwnerDashboardSnapshot.ts",
];
const IMPLEMENTATION_FILES = [
  ...BROWSER_FILES,
  "src/presentation/ownerDashboardBuilder.ts",
  "scripts/export-owner-dashboard-snapshot.ts",
];

test("owner dashboard browser lane is GET-only and cannot reach operational APIs", async () => {
  const source = (await Promise.all(BROWSER_FILES.map((file) => readFile(file, "utf8")))).join("\n");
  assert.doesNotMatch(source, /\b(?:POST|PUT|PATCH|DELETE)\b/);
  assert.doesNotMatch(source, /fetch\s*\(\s*["'`]\/api\/(?:owner|dashboard)/i);
  assert.doesNotMatch(source, /from\s+["'][^"']*(?:server|decision|production|notify-line|notificationWriter|better-sqlite3|sqlite3)[^"']*["']/i);
  assert.match(source, /no-store/);
});

test("owner dashboard implementation has no production, queue-write, or activation imports", async () => {
  const source = (await Promise.all(IMPLEMENTATION_FILES.map((file) => readFile(file, "utf8")))).join("\n");
  assert.doesNotMatch(source, /from\s+["'][^"']*(?:server\/db|src\/decision|src\/production|notify-line|notificationWriter|better-sqlite3|sqlite3|automation\/requests)[^"']*["']/i);
  assert.doesNotMatch(source, /attemptCount\s*[+\-]=|attemptCount\s*=\s*attemptCount\s*[+\-]/);
  assert.doesNotMatch(source, /activateTask|dispatchTask|writeQueue|updateQueue|persistDecision/i);
});
