import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const scriptFiles = readdirSync("scripts").filter((name) => name.endsWith(".ts"));
const scriptSources = new Map(scriptFiles.map((name) => [name, readFileSync(`scripts/${name}`, "utf8")]));
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { scripts?: Record<string, string> };

const guardedRawFiles = scriptFiles.filter((name) => {
  if (!name.endsWith("-raw.ts")) return false;
  return scriptSources.get(name)?.includes("DIRECT_EXECUTION_FORBIDDEN") === true;
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("direct-CLI-protected research raw modules are never launched as child-process CLIs", () => {
  assert.ok(guardedRawFiles.length > 0, "expected at least one direct-CLI-protected raw research module");

  for (const rawFile of guardedRawFiles) {
    const rawPath = `scripts/${rawFile}`;
    const escapedRawPath = escapeRegExp(rawPath);
    const childProcessPatterns = [
      new RegExp(`run\\(\\s*[\"']${escapedRawPath}[\"']`, "u"),
      new RegExp(`spawnSync\\([\\s\\S]{0,500}[\"']${escapedRawPath}[\"']`, "u"),
      new RegExp(`execFileSync\\([\\s\\S]{0,500}[\"']${escapedRawPath}[\"']`, "u"),
      new RegExp(`execSync\\([\\s\\S]{0,500}${escapedRawPath}`, "u"),
    ];

    for (const [caller, source] of scriptSources) {
      if (caller === rawFile) continue;
      for (const pattern of childProcessPatterns) {
        assert.doesNotMatch(
          source,
          pattern,
          `${caller} must not launch direct-CLI-protected ${rawFile}; import its guard in-process after canonical preflight instead`,
        );
      }
    }

    for (const [command, value] of Object.entries(pkg.scripts ?? {})) {
      assert.equal(
        value.includes(rawPath),
        false,
        `package script ${command} must not expose direct-CLI-protected ${rawFile}`,
      );
    }
  }
});
