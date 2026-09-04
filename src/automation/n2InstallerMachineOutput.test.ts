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

test("installer existing private authorities require canonical single-link 0600 regular files", () => {
  assert.match(installer, /leaf = lstatSync\(path\)/u);
  assert.match(installer, /\(error as NodeJS\.ErrnoException\)\.code === "ENOENT"/u);
  assert.match(installer, /PRIVATE_AUTHORITY_SYMLINK_NOT_ALLOWED/u);
  assert.match(installer, /PRIVATE_AUTHORITY_REGULAR_FILE_REQUIRED/u);
  assert.match(installer, /stat\.nlink !== 1/u);
  assert.match(installer, /PRIVATE_AUTHORITY_HARDLINK_NOT_ALLOWED/u);
  assert.match(installer, /\(stat\.mode & 0o777\) !== 0o600/u);
  assert.match(installer, /PRIVATE_AUTHORITY_MODE_INVALID/u);
  assert.match(installer, /realpathSync\.native\(path\) !== resolve\(path\)/u);
  assert.match(installer, /PRIVATE_AUTHORITY_PATH_ALIAS_NOT_ALLOWED/u);
});

test("installer private authority writes reject aliased parent directories", () => {
  assert.match(installer, /function ensurePrivateDirectory\(path: string\): void/u);
  assert.match(installer, /PRIVATE_WRITE_PATH_ESCAPES_DATA_ROOT/u);
  assert.match(installer, /rootStat\.isSymbolicLink\(\) \|\| !rootStat\.isDirectory\(\)/u);
  assert.match(installer, /realpathSync\.native\(root\) !== root/u);
  assert.match(installer, /stat\.isSymbolicLink\(\) \|\| !stat\.isDirectory\(\)/u);
  assert.match(installer, /realpathSync\.native\(current\) !== resolve\(current\)/u);
  assert.match(installer, /PRIVATE_WRITE_PARENT_INVALID/u);
  assert.match(installer, /ensurePrivateDirectory\(dirname\(path\)\)/u);
  assert.match(installer, /ensurePrivateDirectory\(privateRoot\)/u);
  assert.match(installer, /ensurePrivateDirectory\(logsPath\)/u);
  assert.doesNotMatch(installer, /mkdirSync\(privateRoot, \{ recursive: true/u);
  assert.doesNotMatch(installer, /mkdirSync\(logsPath, \{ recursive: true/u);
});
