import { existsSync, readFileSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { evaluateShadowOperabilityGate } from "../src/research-replay/shadowOperabilityPolicy";

const args = process.argv.slice(2);
const allowed = new Set(["sidecar", "policy", "as-of", "mode"]);
const values = new Map<string, string>();
for (const arg of args) {
  const match = /^--([a-z-]+)=(.+)$/.exec(arg);
  if (!match || !allowed.has(match[1]) || values.has(match[1])) {
    throw new Error(`SHADOW_OPERABILITY_INVALID_ARGUMENT:${arg}`);
  }
  values.set(match[1], match[2]);
}
for (const name of allowed) {
  if (!values.has(name)) throw new Error(`SHADOW_OPERABILITY_REQUIRED_ARGUMENT:${name}`);
}
const mode = values.get("mode");
if (mode !== "simulated" && mode !== "production") {
  throw new Error("SHADOW_OPERABILITY_INVALID_MODE");
}
const policyPath = resolve(values.get("policy")!);
const sidecarPath = resolve(values.get("sidecar")!);
const walPath = `${sidecarPath}-wal`;
if (existsSync(walPath) && statSync(walPath).size > 0) {
  throw new Error("SHADOW_OPERABILITY_ACTIVE_WAL_REJECTED_USE_QUIESCENT_SNAPSHOT");
}
const policy = JSON.parse(readFileSync(policyPath, "utf8")) as unknown;
const uri = `${pathToFileURL(sidecarPath).href}?immutable=1`;
const db = new DatabaseSync(uri, { readOnly: true } as never);
try {
  db.exec("PRAGMA query_only=ON");
  const gate = evaluateShadowOperabilityGate(db, {
    policy,
    asOf: values.get("as-of")!,
    executionMode: mode,
  });
  process.stdout.write(`${JSON.stringify(gate, null, 2)}\n`);
  process.exitCode = gate.status === "PASS" ? 0 : gate.status === "WARN" ? 2 : 3;
} finally {
  db.close();
}
