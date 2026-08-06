import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const installer = readFileSync(
  resolve(process.cwd(), "scripts/install-n2-trifecta-local-capture-agent.ts"),
  "utf8",
);

test("immutable runtime npm install output is captured before final JSON", () => {
  assert.match(
    installer,
    /run\("npm", \["ci"\], \{ cwd: runtimeRoot, capture: true \}\)/u,
  );
  assert.doesNotMatch(
    installer,
    /run\("npm", \["ci"\], \{ cwd: runtimeRoot \}\)/u,
  );
});

test("installer keeps explicit JSON dispositions and isolated print-only plist output", () => {
  const consoleLogs = installer.match(/console\.log\(/gu) ?? [];
  const structuredLogs = installer.match(/console\.log\(JSON\.stringify\(\{/gu) ?? [];
  assert.equal(consoleLogs.length, 3);
  assert.equal(structuredLogs.length, 2);
  assert.match(installer, /if \(printOnly\) console\.log\(plist\)/u);
});
