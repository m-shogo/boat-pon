/**
 * Guarded compatibility boundary for the wind24 × exhibition-rank deep dive.
 *
 * 格上げ条件 / 降格条件の研究ロジックは legacy internal implementation に保持する。
 * この module は canonical settlement preflight を通過した親 entrypoint からのみ実行できる。
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

if (process.env.BOAT_PON_WIND24_CORE_GUARD !== "1") {
  throw new Error("WIND24_SWITCH_CORE_DIRECT_EXECUTION_FORBIDDEN");
}

const configuredDbPath = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
if (!existsSync(configuredDbPath)) {
  throw new Error("WIND24_SWITCH_CORE_DB_MISSING");
}

const verifiedDbPath = assertCanonicalSingleLinkRegularFile(
  configuredDbPath,
  "WIND24_SWITCH_CORE_DB_IDENTITY_INVALID",
);
const internalPath = fileURLToPath(new URL("./analyze-wind24-exh1-switch-deep-dive-internal.ts", import.meta.url));
const tsxLoader = import.meta.resolve("tsx");

const result = spawnSync(process.execPath, ["--import", tsxLoader, internalPath], {
  stdio: "inherit",
  env: {
    ...process.env,
    BOAT_PON_DB_PATH: verifiedDbPath,
    BOAT_PON_WIND24_CORE_GUARD: "0",
  },
});
if (result.error || result.status !== 0) {
  throw new Error("WIND24_SWITCH_CORE_INTERNAL_FAILED");
}
