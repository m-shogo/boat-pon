#!/usr/bin/env node
/**
 * Dependency-free smoke runner for the Phase 1/2 research domain modules.
 *
 * Use when node_modules (tsx/typescript) is unavailable — this script uses
 * only Node built-ins plus Node's native `--experimental-strip-types`.
 *
 * Scope: only src/domain/research*.ts and their direct runtime dependency
 * (backtest.ts, types.ts). These have zero third-party npm imports, so they
 * can run standalone. This is intentionally NOT the full src/domain suite —
 * most other domain files (parsers, etc.) import real npm packages (e.g.
 * cheerio) that are unavailable without node_modules, so running them here
 * would just fail for unrelated reasons. Use `pnpm test` for full coverage
 * once a normal pnpm environment is available.
 *
 * Node's native TS loader (unlike tsx) does not resolve extensionless
 * relative imports, but this project's src/domain/*.ts files follow the
 * tsx/vite convention of importing without an extension (e.g. `from
 * "./researchRule"`). This script copies the files below into a temp
 * directory, appends `.ts` to extensionless relative imports in the copies
 * only, then runs `node --experimental-strip-types --test` against them.
 * The real source files under src/domain/ are never modified.
 *
 * This is NOT a replacement for `pnpm test` — it is a fallback for
 * environments where `pnpm install` cannot complete. See
 * docs/ai/05-VERIFICATION.md.
 */

import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const KNOWN_EXTENSIONS = new Set(["ts", "tsx", "js", "jsx", "mjs", "cjs", "json"]);

/**
 * A naive `/\.[a-zA-Z]+$/` check misfires on specifiers like
 * "./researchViewModel.adapters" (no real extension, just a dot in the
 * filename) — only treat it as "already has an extension" if the suffix is a
 * known one.
 */
function hasKnownExtension(spec) {
  const match = spec.match(/\.([a-zA-Z0-9]+)$/);
  return match != null && KNOWN_EXTENSIONS.has(match[1].toLowerCase());
}

const SCOPE_FILES = [
  "types.ts",
  "backtest.ts",
  "researchRule.ts",
  "researchRuleLifecycle.ts",
  "researchRuleLifecycle.test.ts",
  "researchEvaluation.ts",
  "researchEvaluation.test.ts",
  "researchDrift.ts",
  "researchDrift.test.ts",
];

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const domainDir = join(repoRoot, "src", "domain");
const tempDir = mkdtempSync(join(tmpdir(), "boatpon-verify-strip-types-"));

try {
  for (const name of SCOPE_FILES) {
    copyFileSync(join(domainDir, name), join(tempDir, name));
  }
  addExplicitTsExtensions(tempDir);

  const testFiles = SCOPE_FILES.filter((name) => name.endsWith(".test.ts")).map((name) => join(tempDir, name));

  console.log(`running ${testFiles.length} test file(s) via node --experimental-strip-types --test (fallback runner)`);
  console.log(`scope: ${SCOPE_FILES.join(", ")}`);
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "--test", ...testFiles], {
    stdio: "inherit",
  });
  process.exit(result.status ?? 1);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

/** `from "./x"` / `from "../x"` -> `from "./x.ts"` when no extension is already present. */
function addExplicitTsExtensions(dir) {
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".ts")) continue;
    const path = join(dir, name);
    const content = readFileSync(path, "utf8");
    const fixed = content.replace(/from\s+"(\.\.?\/[^"]+)"/g, (full, spec) => {
      if (hasKnownExtension(spec)) return full;
      return full.replace(spec, `${spec}.ts`);
    });
    if (fixed !== content) writeFileSync(path, fixed, "utf8");
  }
}
