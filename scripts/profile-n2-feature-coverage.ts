import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildN2FeatureCoverageProfile, type N2FeatureCoverageEvent } from "../src/research-replay/n2FeatureCoverage";
import { readOfficialProgramCoverageEvents } from "../src/research-replay/n2FeatureCoverageReader";

const args = process.argv.slice(2);
const value = (name: string) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const inputArg = value("input");
const primary = value("primary");
const sidecar = value("sidecar");
const dateFrom = value("from");
const dateTo = value("to");
const fixture = process.argv.includes("--fixture");
if (inputArg && (primary || sidecar || dateFrom || dateTo)) throw new Error("N2_COVERAGE_MIXED_INPUT_MODES");
if ([primary, sidecar, dateFrom, dateTo].some(Boolean) && ![primary, sidecar, dateFrom, dateTo].every(Boolean)) {
  throw new Error("N2_COVERAGE_INCOMPLETE_DB_INPUT");
}
const events = inputArg
  ? JSON.parse(readFileSync(resolve(inputArg), "utf8")) as N2FeatureCoverageEvent[]
  : primary && sidecar && dateFrom && dateTo
    ? readOfficialProgramCoverageEvents({
      primaryDbPath: resolve(primary), sidecarDbPath: resolve(sidecar), dateFrom, dateTo,
    })
    : [];
const profile = buildN2FeatureCoverageProfile({ inputKind: fixture ? "fixture" : "real", events });
process.stdout.write(`${JSON.stringify(profile, null, 2)}\n`);
if (profile.dataStatus === "PENDING_REAL_DATA") process.exitCode = 2;
