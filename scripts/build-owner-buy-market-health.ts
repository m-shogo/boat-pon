import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { buildOwnerBuyMarketHealth } from "../src/presentation/ownerBuyMarketHealth";

const args = parseArgs(process.argv.slice(2));
const readJson = async (path: string) => JSON.parse(await readFile(path, "utf8")) as unknown;
const health = buildOwnerBuyMarketHealth({
  generatedAt: new Date().toISOString(),
  buyLearning: await readJson(args.buyLearning),
  calibration: await readJson(args.calibration),
  roiUncertainty: await readJson(args.roiUncertainty),
});
await atomicWrite(args.output, `${JSON.stringify(health, null, 2)}\n`);
console.log(JSON.stringify({
  status: health.status,
  output: args.output,
  decisionEffectiveHitRate: health.probability?.decisionEffectiveHitRate ?? null,
  observedHitRate: health.probability?.observedHitRate ?? null,
  calibrationStability: health.probability?.stability ?? null,
  featureToDecisionRetention: health.probability?.featureToDecisionRetention ?? null,
  realizedToExpectedRatio: health.evRealization?.performance.realizedToExpectedRatio ?? null,
  evClassification: health.evRealization?.performance.classification ?? null,
  priceHits: health.priceReadiness?.performance.hits ?? null,
  priceMinimumHits: health.priceReadiness?.minimumHits ?? null,
  priceMissingHits: health.priceReadiness?.performance.missingHits ?? null,
  productionChangeAllowed: false,
}));

function parseArgs(argv: string[]) {
  const parsed = { buyLearning: null as string | null, calibration: null as string | null, roiUncertainty: null as string | null, output: null as string | null };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i]; const value = argv[i + 1];
    if (key === "--buy-learning") { parsed.buyLearning = safeJson(value); i += 1; }
    else if (key === "--calibration") { parsed.calibration = safeJson(value); i += 1; }
    else if (key === "--roi-uncertainty") { parsed.roiUncertainty = safeJson(value); i += 1; }
    else if (key === "--output") { parsed.output = safeJson(value); i += 1; }
    else if (key === "--") { /* npm separator */ }
    else throw new Error(`unknown option: ${key}`);
  }
  if (!parsed.buyLearning || !parsed.calibration || !parsed.roiUncertainty || !parsed.output) throw new Error("buy-learning, calibration, roi-uncertainty, and output are required");
  return parsed as { buyLearning: string; calibration: string; roiUncertainty: string; output: string };
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
