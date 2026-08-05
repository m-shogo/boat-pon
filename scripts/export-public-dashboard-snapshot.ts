import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { buildPublicDashboardSnapshot } from "../src/presentation/publicSnapshotBuilder";
import { sealPublicDashboardSnapshot } from "../src/presentation/publicSnapshotTransport";

const options = parseArgs(process.argv.slice(2));

const [catalog, queueState, currentRun, readiness] = await Promise.all([
  readJson(options.catalog),
  readJson(options.queueState),
  readJson(options.currentRun),
  readJson(options.readiness),
]);

const generatedAt = new Date().toISOString();
const snapshot = buildPublicDashboardSnapshot({
  catalog,
  queueState,
  currentRun,
  readiness,
  generatedAt,
  modelVersion: options.modelVersion,
});
const sealed = await sealPublicDashboardSnapshot(snapshot);

const output = resolve(options.output);
const temporary = `${output}.${process.pid}.tmp`;
await mkdir(dirname(output), { recursive: true });
try {
  await writeFile(temporary, `${JSON.stringify(sealed, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o644,
    flag: "wx",
  });
  await rename(temporary, output);
} finally {
  await rm(temporary, { force: true });
}

process.stdout.write(`${JSON.stringify({
  schemaVersion: sealed.schemaVersion,
  generatedAt: sealed.generatedAt,
  dataAsOf: sealed.dataAsOf,
  digest: sealed.integrity.digest,
  pipelineTasks: sealed.pipeline.length,
})}\n`);

type CliOptions = {
  catalog: string;
  queueState: string;
  currentRun: string;
  readiness: string;
  output: string;
  modelVersion: string;
};

function parseArgs(args: string[]): CliOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error(`invalid argument near ${key ?? "<end>"}`);
    }
    values.set(key.slice(2), value);
  }

  return {
    catalog: required(values, "catalog"),
    queueState: required(values, "queue-state"),
    currentRun: required(values, "current-run"),
    readiness: required(values, "readiness"),
    output: required(values, "output"),
    modelVersion: required(values, "model-version"),
  };
}

function required(values: Map<string, string>, name: string): string {
  const value = values.get(name)?.trim();
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(path), "utf8")) as unknown;
}
