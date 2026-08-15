import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { validateBuyLearningSummary, type BuyLearningSummary } from "../src/presentation/buyLearningSummary";
import { mergeBuyTailLearning } from "../src/presentation/buyTailLearningMerge";

const args = parseArgs(process.argv.slice(2));
if (!existsSync(args.summary)) throw new Error("BUY learning summary is unavailable");
if (!existsSync(args.tailSignal)) throw new Error("BUY tail signal is unavailable");

const summary = JSON.parse(await readFile(args.summary, "utf8")) as BuyLearningSummary;
const beforeErrors = validateBuyLearningSummary(summary);
if (beforeErrors.length) throw new Error(`input BUY learning summary invalid: ${beforeErrors.join("; ")}`);
const tail = JSON.parse(await readFile(args.tailSignal, "utf8")) as unknown;
const merged = mergeBuyTailLearning(summary, tail);
const afterErrors = validateBuyLearningSummary(merged);
if (afterErrors.length) throw new Error(`tail-enriched BUY learning summary invalid: ${afterErrors.join("; ")}`);

await atomicWrite(args.summary, `${JSON.stringify(merged, null, 2)}\n`);
const retained = await retainPrivateLearning(args.retainPrivateDir, merged);
console.log(JSON.stringify({
  status: merged.status,
  learningCount: merged.learnings.length,
  researchCandidateCount: merged.researchCandidates.length,
  tailLearningAdded: merged.learnings.length > summary.learnings.length,
  privateLearningRetained: retained,
  productionChangeAllowed: false,
}));

function parseArgs(argv: string[]) {
  const parsed = { summary: null as string | null, tailSignal: null as string | null, retainPrivateDir: null as string | null };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i]; const value = argv[i + 1];
    if (key === "--summary") { parsed.summary = safeJson(value); i += 1; }
    else if (key === "--tail-signal") { parsed.tailSignal = safeJson(value); i += 1; }
    else if (key === "--retain-private-dir") { parsed.retainPrivateDir = safePrivateDir(value); i += 1; }
    else if (key === "--") { /* npm separator */ }
    else throw new Error(`unknown option: ${key}`);
  }
  if (!parsed.summary || !parsed.tailSignal || !parsed.retainPrivateDir) throw new Error("summary, tail-signal, and retain-private-dir are required");
  return parsed as { summary: string; tailSignal: string; retainPrivateDir: string };
}

function safeJson(value: string | undefined) {
  if (!value || value.startsWith("/") || value.includes("..") || !/^[A-Za-z0-9_./-]+\.json$/.test(value)) throw new Error("input must be a relative json path");
  return value;
}
function safePrivateDir(value: string | undefined) {
  if (!value || !/^data\/private\/[A-Za-z0-9_./-]+$/.test(value) || value.includes("..")) throw new Error("private retention must stay under data/private");
  return value.replace(/\/$/, "");
}
async function atomicWrite(path: string, contents: string) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}`;
  await writeFile(temp, contents, { encoding: "utf8", mode: 0o600 });
  await rename(temp, path);
}
async function retainPrivateLearning(dir: string, summary: BuyLearningSummary): Promise<boolean> {
  const semantic = { ...summary, generatedAt: undefined };
  const digest = createHash("sha256").update(JSON.stringify(semantic)).digest("hex");
  const record = { schemaVersion: "buy-outcome-learning-ledger.0.1", semanticDigest: digest, recordedAt: new Date().toISOString(), summary };
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, `buy-learning-${digest}.json`);
  try {
    await writeFile(path, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    return true;
  } catch (error) {
    if (!isNodeError(error) || error.code !== "EEXIST") throw error;
    const existing = JSON.parse(await readFile(path, "utf8")) as { semanticDigest?: string };
    if (existing.semanticDigest !== digest) throw new Error("private BUY learning ledger conflict");
    return false;
  }
}
function isNodeError(error: unknown): error is NodeJS.ErrnoException { return error instanceof Error && "code" in error; }
