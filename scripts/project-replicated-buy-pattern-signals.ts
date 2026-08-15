import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const args = parseArgs(process.argv.slice(2));
if (!existsSync(args.input)) throw new Error("BUY pattern replication report is unavailable");
const source = JSON.parse(await readFile(args.input, "utf8")) as Record<string, unknown>;
if (source.schemaVersion !== "buy-pattern-replication-public-v1" || source.productionChangeAllowed !== false || !Array.isArray(source.signals)) {
  throw new Error("invalid BUY pattern replication report");
}
const signals = source.signals.map(validateSignal).slice(0, 6);
const output = {
  schemaVersion: "buy-outcome-pattern-public-v1" as const,
  generatedAt: source.generatedAt,
  status: signals.length ? "SIGNALS_FOUND" as const : "NO_SIGNAL" as const,
  analyzedSettled: count(source.totalSettled),
  signals,
  productionChangeAllowed: false as const,
};
const serialized = JSON.stringify(output);
for (const forbidden of ["segmentKey", "selection", "currentOdds", "requiredOdds", "recommendedAmount", "stake", "raceId", "decisionId", "/Users/", "/home/"]) {
  if (serialized.toLowerCase().includes(forbidden.toLowerCase())) throw new Error(`private BUY field reached replicated pattern projection: ${forbidden}`);
}
await atomicWrite(args.output, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ status: output.status, analyzedSettled: output.analyzedSettled, signalCount: signals.length, productionChangeAllowed: false }));

function validateSignal(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("invalid replicated BUY signal");
  const signal = raw as Record<string, unknown>;
  const allowed = new Set(["id", "direction", "dimension", "evidenceCount", "roiDelta", "confidence", "productionChangeAllowed"]);
  for (const key of Object.keys(signal)) if (!allowed.has(key)) throw new Error(`unknown replicated BUY signal key: ${key}`);
  if (typeof signal.id !== "string" || !/^[A-Z0-9_.-]{2,80}$/.test(signal.id)) throw new Error("invalid replicated BUY signal id");
  if (!["SUCCESS_EDGE", "FAILURE_REGIME"].includes(String(signal.direction))) throw new Error("invalid replicated BUY signal direction");
  if (!["venue", "modelVersion", "confidenceBand", "evBand", "oddsBand", "sampleBand"].includes(String(signal.dimension))) throw new Error("invalid replicated BUY signal dimension");
  if (!Number.isInteger(signal.evidenceCount) || Number(signal.evidenceCount) < 20) throw new Error("invalid replicated BUY signal support");
  if (typeof signal.roiDelta !== "number" || !Number.isFinite(signal.roiDelta) || signal.roiDelta === 0 || Math.abs(signal.roiDelta) > 100) throw new Error("invalid replicated BUY signal ROI delta");
  if (!["WATCH", "STRONG"].includes(String(signal.confidence))) throw new Error("invalid replicated BUY signal confidence");
  if (signal.productionChangeAllowed !== false) throw new Error("replicated BUY signal cannot allow production change");
  return signal;
}

function parseArgs(argv: string[]) {
  const parsed = { input: null as string | null, output: null as string | null };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i]; const value = argv[i + 1];
    if (key === "--input") { parsed.input = safeJson(value); i += 1; }
    else if (key === "--output") { parsed.output = safeJson(value); i += 1; }
    else if (key === "--") { /* npm separator */ }
    else throw new Error(`unknown option: ${key}`);
  }
  if (!parsed.input || !parsed.output) throw new Error("input and output are required");
  return parsed as { input: string; output: string };
}
function safeJson(value: string | undefined) { if (!value || value.startsWith("/") || value.includes("..") || !/^[A-Za-z0-9_./-]+\.json$/.test(value)) throw new Error("path must be a relative json file"); return value; }
function count(value: unknown) { const n = Number(value ?? 0); return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0; }
async function atomicWrite(path: string, contents: string) { await mkdir(dirname(path), { recursive: true }); const temp = `${path}.tmp-${process.pid}`; await writeFile(temp, contents, { encoding: "utf8", mode: 0o600 }); await rename(temp, path); }
