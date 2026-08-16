import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

const args = parseArgs(process.argv.slice(2));
if (!existsSync(args.patterns)) throw new Error("BUY pattern public summary is unavailable");
const value = JSON.parse(await readFile(args.patterns, "utf8")) as Record<string, unknown>;
if (value.schemaVersion !== "buy-outcome-pattern-public-v1" || value.productionChangeAllowed !== false || !isRecord(value.support)) throw new Error("invalid BUY pattern public summary");
const support = value.support;
const status = String(support.status);
if (!["INSUFFICIENT_GLOBAL_SUPPORT", "NO_SUPPORTED_CONTRAST", "SUPPORTED_CONTRASTS"].includes(status)) throw new Error("invalid BUY pattern support status");
const analyzedSettled = count(value.analyzedSettled, "analyzedSettled");
const minimumSettledPerSide = count(support.minimumSettledPerSide, "minimumSettledPerSide");
const segmentSideEligibleCount = count(support.segmentSideEligibleCount, "segmentSideEligibleCount");
const universalEligibleSegmentCount = count(support.universalEligibleSegmentCount, "universalEligibleSegmentCount");
if (universalEligibleSegmentCount > segmentSideEligibleCount) throw new Error("universal eligible BUY segment count exceeds eligible segments");
const supportedContrastCount = count(support.supportedContrastCount, "supportedContrastCount");
const supportedDimensionCount = count(support.supportedDimensionCount, "supportedDimensionCount");
const closestObservedComplementSettled = nullableCount(support.closestObservedComplementSettled, "closestObservedComplementSettled");
const minimumObservedComplementShortfall = nullableCount(support.minimumObservedComplementShortfall, "minimumObservedComplementShortfall");
if ((segmentSideEligibleCount === 0) !== (closestObservedComplementSettled === null || minimumObservedComplementShortfall === null)) throw new Error("BUY pattern complement readiness nullability mismatch");
if (closestObservedComplementSettled !== null && minimumObservedComplementShortfall !== Math.max(0, minimumSettledPerSide - closestObservedComplementSettled)) throw new Error("BUY pattern complement shortfall mismatch");
if (supportedContrastCount > 0 && minimumObservedComplementShortfall !== 0) throw new Error("supported BUY contrast must have zero complement shortfall");
const contrastBlocker = support.contrastBlocker === null ? null : String(support.contrastBlocker);
if (contrastBlocker !== null && !["NO_ELIGIBLE_SEGMENT", "UNIVERSAL_SEGMENT_COVERAGE", "COMPLEMENT_SUPPORT_SHORTFALL"].includes(contrastBlocker)) throw new Error("invalid BUY pattern contrast blocker");
if (supportedContrastCount > 0 && contrastBlocker !== null) throw new Error("supported BUY contrast cannot have blocker");
if (contrastBlocker === "NO_ELIGIBLE_SEGMENT" && segmentSideEligibleCount !== 0) throw new Error("NO_ELIGIBLE_SEGMENT blocker mismatch");
if (contrastBlocker === "UNIVERSAL_SEGMENT_COVERAGE" && (segmentSideEligibleCount === 0 || universalEligibleSegmentCount !== segmentSideEligibleCount || closestObservedComplementSettled !== 0)) throw new Error("UNIVERSAL_SEGMENT_COVERAGE blocker mismatch");
if (contrastBlocker === "COMPLEMENT_SUPPORT_SHORTFALL" && (segmentSideEligibleCount === 0 || minimumObservedComplementShortfall === null || minimumObservedComplementShortfall <= 0)) throw new Error("COMPLEMENT_SUPPORT_SHORTFALL blocker mismatch");
const noSignalReason = value.noSignalReason === null ? null : String(value.noSignalReason);
if (noSignalReason !== null && !["INSUFFICIENT_GLOBAL_SUPPORT", "NO_SUPPORTED_CONTRAST", "NO_MATERIAL_ROI_CONTRAST"].includes(noSignalReason)) throw new Error("invalid BUY pattern noSignalReason");
const report = {
  schemaVersion: "buy-pattern-support-readiness-v1",
  status,
  analyzedSettled,
  minimumSettledPerSide,
  segmentSideEligibleCount,
  universalEligibleSegmentCount,
  closestObservedComplementSettled,
  minimumObservedComplementShortfall,
  contrastBlocker,
  supportedContrastCount,
  supportedDimensionCount,
  noSignalReason,
  productionChangeAllowed: false,
};
const serialized = JSON.stringify(report);
for (const forbidden of ["segmentKey", "selection", "currentOdds", "requiredOdds", "recommendedAmount", "stake", "raceId", "decisionId", "/Users/", "/home/"]) {
  if (serialized.toLowerCase().includes(forbidden.toLowerCase())) throw new Error(`private BUY field reached contrast readiness report: ${forbidden}`);
}
console.log(serialized);

function parseArgs(argv: string[]) {
  let patterns: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i]; const value = argv[i + 1];
    if (key === "--patterns") { patterns = safeJson(value); i += 1; }
    else if (key === "--") { /* npm separator */ }
    else throw new Error(`unknown option: ${key}`);
  }
  if (!patterns) throw new Error("--patterns is required");
  return { patterns };
}
function safeJson(value: string | undefined) { if (!value || value.startsWith("/") || value.includes("..") || !/^[A-Za-z0-9_./-]+\.json$/.test(value)) throw new Error("patterns must be a relative json path"); return value; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function count(value: unknown, name: string) { if (!Number.isInteger(value) || Number(value) < 0) throw new Error(`invalid BUY pattern ${name}`); return Number(value); }
function nullableCount(value: unknown, name: string) { if (value === null) return null; return count(value, name); }
