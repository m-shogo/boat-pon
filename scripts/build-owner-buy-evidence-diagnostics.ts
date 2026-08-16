import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { buildOwnerBuyEvidenceDiagnostics } from "../src/presentation/ownerBuyEvidenceDiagnostics";

const args = parseArgs(process.argv.slice(2));
const readJson = async (path: string) => JSON.parse(await readFile(path, "utf8")) as unknown;
const diagnostics = buildOwnerBuyEvidenceDiagnostics({
  generatedAt: new Date().toISOString(),
  buyLearning: await readJson(args.buyLearning),
  patterns: await readJson(args.patterns),
  tail: await readJson(args.tail),
  uncertainty: await readJson(args.uncertainty),
  roiUncertainty: await readJson(args.roiUncertainty),
});
await atomicWrite(args.output, `${JSON.stringify(diagnostics, null, 2)}\n`);
console.log(JSON.stringify({
  status: diagnostics.status,
  output: args.output,
  patternSupport: diagnostics.patternSupport?.status ?? null,
  patternContrastBlocker: diagnostics.patternSupport?.contrastBlocker ?? null,
  universalEligibleSegmentCount: diagnostics.patternSupport?.universalEligibleSegmentCount ?? null,
  closestObservedComplementSettled: diagnostics.patternSupport?.closestObservedComplementSettled ?? null,
  minimumObservedComplementShortfall: diagnostics.patternSupport?.minimumObservedComplementShortfall ?? null,
  supportedContrastCount: diagnostics.patternSupport?.supportedContrastCount ?? null,
  tailStability: diagnostics.tailStability?.status ?? null,
  performanceHitRate95: diagnostics.hitRateUncertainty?.performance == null ? null : [diagnostics.hitRateUncertainty.performance.lower, diagnostics.hitRateUncertainty.performance.upper],
  performanceRoi95: diagnostics.roiUncertainty?.performance.interval == null ? null : [diagnostics.roiUncertainty.performance.interval.lower, diagnostics.roiUncertainty.performance.interval.upper],
  performanceRoiClassification: diagnostics.roiUncertainty?.performance.interval?.classification ?? null,
  productionChangeAllowed: false,
}));

function parseArgs(argv: string[]) {
  const parsed = { buyLearning: null as string | null, patterns: null as string | null, tail: null as string | null, uncertainty: null as string | null, roiUncertainty: null as string | null, output: null as string | null };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i]; const value = argv[i + 1];
    if (key === "--buy-learning") { parsed.buyLearning = safeJson(value); i += 1; }
    else if (key === "--patterns") { parsed.patterns = safeJson(value); i += 1; }
    else if (key === "--tail") { parsed.tail = safeJson(value); i += 1; }
    else if (key === "--uncertainty") { parsed.uncertainty = safeJson(value); i += 1; }
    else if (key === "--roi-uncertainty") { parsed.roiUncertainty = safeJson(value); i += 1; }
    else if (key === "--output") { parsed.output = safeJson(value); i += 1; }
    else if (key === "--") { /* npm separator */ }
    else throw new Error(`unknown option: ${key}`);
  }
  if (!parsed.buyLearning || !parsed.patterns || !parsed.tail || !parsed.uncertainty || !parsed.roiUncertainty || !parsed.output) throw new Error("buy-learning, patterns, tail, uncertainty, roi-uncertainty, and output are required");
  return parsed as { buyLearning: string; patterns: string; tail: string; uncertainty: string; roiUncertainty: string; output: string };
}
function safeJson(value: string | undefined) {
  if (!value || value.startsWith("/") || value.includes("..") || !/^[A-Za-z0-9_./-]+\.json$/.test(value)) throw new Error("path must be a relative json file");
  return value;
}
async function atomicWrite(path: string, contents: string) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}`;
  await writeFile(temp, contents, { encoding: "utf8", mode: 0o600 });
  await rename(temp, path);
}
