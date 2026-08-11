import { resolve } from "node:path";
import { parsePublicDeployCliArgs } from "../src/presentation/publicDeployCliArgs";
import { assemblePublicDashboardDeploy } from "../src/presentation/publicDeployBundle";

const args = parsePublicDeployCliArgs(process.argv.slice(2));
const manifest = await assemblePublicDashboardDeploy({
  distDir: args.dist,
  staticDir: args.static,
  outputDir: args.output,
  snapshotDir: args.snapshot ?? null,
});

console.log(JSON.stringify({
  status: "PASS",
  output: resolve(args.output),
  entry: manifest.entry,
  files: manifest.files.length,
}, null, 2));
