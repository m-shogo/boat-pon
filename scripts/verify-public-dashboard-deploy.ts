import { resolve } from "node:path";
import { verifyPublicDashboardDeploy } from "../src/presentation/publicDeployBundle";

const directory = parseDirectory(process.argv.slice(2));
const result = await verifyPublicDashboardDeploy(directory);

if (!result.ok) {
  console.error(JSON.stringify({
    status: "FAILED",
    directory: resolve(directory),
    errors: result.errors,
  }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({
    status: "PASS",
    directory: resolve(directory),
    entry: result.manifest?.entry,
    files: result.manifest?.files.length ?? 0,
  }, null, 2));
}

function parseDirectory(args: string[]): string {
  if (args.length !== 1 || !args[0].startsWith("--dir=")) {
    throw new Error("usage: tsx scripts/verify-public-dashboard-deploy.ts --dir=<path>");
  }
  const value = args[0].slice("--dir=".length).trim();
  if (!value) throw new Error("--dir=<path> is required");
  return value;
}
