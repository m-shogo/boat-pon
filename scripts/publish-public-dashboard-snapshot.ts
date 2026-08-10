import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { validatePublicSnapshotForPublication } from "../src/presentation/publicSnapshotPublisher";

const args = parseArgs(process.argv.slice(2));
const candidatePath = required(args, "candidate");
const latestPath = required(args, "latest");
const lastKnownGoodPath = required(args, "last-known-good");
const nowMs = args.now ? Date.parse(args.now) : Date.now();

const candidate = await readJson(candidatePath);
const existingLastKnownGood = await readOptionalJson(lastKnownGoodPath);
const validation = await validatePublicSnapshotForPublication({
  candidate,
  existingLastKnownGood,
  nowMs,
});

if (!validation.ok || !validation.snapshot) {
  console.error(`PUBLIC_SNAPSHOT_PUBLICATION_BLOCKED ${validation.errors.join(",")}`);
  process.exit(1);
}

const body = `${JSON.stringify(validation.snapshot, null, 2)}\n`;
await writePairAtomically({
  latestPath,
  lastKnownGoodPath,
  body,
});

console.log([
  "PUBLIC_SNAPSHOT_PUBLISHED",
  `digest=${validation.snapshot.integrity.digest}`,
  `dataAsOf=${validation.snapshot.dataAsOf}`,
  validation.warnings.length ? `warnings=${validation.warnings.join(",")}` : "warnings=NONE",
].join(" "));

async function writePairAtomically(options: {
  latestPath: string;
  lastKnownGoodPath: string;
  body: string;
}): Promise<void> {
  const latestDirectory = dirname(options.latestPath);
  const lastKnownGoodDirectory = dirname(options.lastKnownGoodPath);
  await Promise.all([
    mkdir(latestDirectory, { recursive: true }),
    mkdir(lastKnownGoodDirectory, { recursive: true }),
  ]);

  const token = randomUUID();
  const latestTemp = join(latestDirectory, `.latest-${token}.tmp`);
  const lastKnownGoodTemp = join(lastKnownGoodDirectory, `.last-known-good-${token}.tmp`);

  try {
    await Promise.all([
      writeFile(latestTemp, options.body, { encoding: "utf8", flag: "wx" }),
      writeFile(lastKnownGoodTemp, options.body, { encoding: "utf8", flag: "wx" }),
    ]);
    await rename(lastKnownGoodTemp, options.lastKnownGoodPath);
    await rename(latestTemp, options.latestPath);
  } finally {
    await Promise.all([
      rm(latestTemp, { force: true }),
      rm(lastKnownGoodTemp, { force: true }),
    ]);
  }
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

async function readOptionalJson(path: string): Promise<unknown | undefined> {
  try {
    return await readJson(path);
  } catch (error) {
    if (isErrno(error, "ENOENT")) return undefined;
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

function isErrno(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function parseArgs(argv: string[]): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) throw new Error(`invalid argument near ${key ?? "<end>"}`);
    parsed[key.slice(2)] = value;
  }
  return parsed;
}

function required(args: Record<string, string>, key: string): string {
  const value = args[key];
  if (!value) throw new Error(`--${key} is required`);
  return value;
}
