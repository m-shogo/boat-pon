import { resolve } from "node:path";
import { assemblePublicDashboardDeploy } from "../src/presentation/publicDeployBundle";

const args = parseArgs(process.argv.slice(2));
const manifest = await assemblePublicDashboardDeploy({
  distDir: required(args, "dist"),
  staticDir: required(args, "static"),
  outputDir: required(args, "output"),
  snapshotDir: args.snapshot ?? null,
});

console.log(JSON.stringify({
  status: "PASS",
  output: resolve(required(args, "output")),
  entry: manifest.entry,
  files: manifest.files.length,
}, null, 2));

function parseArgs(values: string[]): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const value of values) {
    if (!value.startsWith("--") || !value.includes("=")) {
      throw new Error(`invalid argument: ${value}`);
    }
    const [key, ...rest] = value.slice(2).split("=");
    const content = rest.join("=").trim();
    if (!key || !content) throw new Error(`invalid argument: ${value}`);
    parsed[key] = content;
  }
  return parsed;
}

function required(args: Record<string, string>, key: string): string {
  const value = args[key];
  if (!value) throw new Error(`--${key}=<path> is required`);
  return value;
}
