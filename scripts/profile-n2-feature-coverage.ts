import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildN2FeatureCoverageProfile, type N2FeatureCoverageEvent } from "../src/research-replay/n2FeatureCoverage";

const inputArg = process.argv.slice(2).find((arg) => arg.startsWith("--input="));
const fixture = process.argv.includes("--fixture");
const events = inputArg
  ? JSON.parse(readFileSync(resolve(inputArg.slice("--input=".length)), "utf8")) as N2FeatureCoverageEvent[]
  : [];
const profile = buildN2FeatureCoverageProfile({ inputKind: fixture ? "fixture" : "real", events });
process.stdout.write(`${JSON.stringify(profile, null, 2)}\n`);
if (profile.dataStatus === "PENDING_REAL_DATA") process.exitCode = 2;
