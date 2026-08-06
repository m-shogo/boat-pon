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

test("installer has one final structured stdout disposition", () => {
  const consoleLogs = installer.match(/console\.log\(/gu) ?? [];
  assert.equal(consoleLogs.length, 2);
  assert.match(installer, /console\.log\(JSON\.stringify\(\{/u);
  assert.match(installer, /if \(printOnly\) console\.log\(plist\)/u);
});
