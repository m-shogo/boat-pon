import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { buildOwnerDashboardSnapshot } from "../src/presentation/ownerDashboardBuilder";
import { buildOwnerBuyMarketHealth } from "../src/presentation/ownerBuyMarketHealth";
import type { OwnerGitCleanliness } from "../src/presentation/ownerDashboardSnapshot";

const args = Object.fromEntries(process.argv.slice(2).reduce<Array<[string,string]>>((acc, value, index, all) => {
  if (value.startsWith("--") && all[index + 1] && !all[index + 1]!.startsWith("--")) acc.push([value.slice(2), all[index + 1]!]);
  return acc;
}, []));
const required = (name: string) => { const value = args[name]; if (!value) throw new Error(`--${name} is required`); return value; };
const readJson = async (path: string) => JSON.parse(await readFile(path, "utf8")) as unknown;
const gitCleanliness = required("git-cleanliness") as OwnerGitCleanliness;
if (!["CLEAN", "ATTENTION", "NOT_AVAILABLE"].includes(gitCleanliness)) throw new Error("invalid --git-cleanliness");

const generatedAt = new Date().toISOString();
const recentCommits = args["recent-commits"] ? await readJson(args["recent-commits"]) : [];
const buyLearning = args["buy-learning"] ? await readJson(args["buy-learning"]) : undefined;
const buyEvidence = args["buy-evidence"] ? await readJson(args["buy-evidence"]) : undefined;
let buyMarketHealth = args["buy-market-health"] ? await readJson(args["buy-market-health"]) : undefined;
if (buyMarketHealth === undefined && buyLearning !== undefined) {
  const calibrationPath = "data/tmp/owner-buy-probability-calibration.json";
  const roiPath = "data/tmp/owner-buy-roi-uncertainty.json";
  if (existsSync(calibrationPath) && existsSync(roiPath)) {
    buyMarketHealth = buildOwnerBuyMarketHealth({
      generatedAt,
      buyLearning,
      calibration: await readJson(calibrationPath),
      roiUncertainty: await readJson(roiPath),
    });
  }
}
const snapshot = buildOwnerDashboardSnapshot({
  generatedAt,
  canonicalBranch: required("canonical-branch"),
  mainSha: required("main-sha"),
  ciStatus: required("ci-status") as "PASS" | "FAIL" | "PENDING" | "NOT_AVAILABLE",
  openPrCount: Number(required("open-pr-count")),
  gitCleanliness,
  gitUpdatedAt: required("git-updated-at"),
  queueState: await readJson(required("queue-state")),
  taskCatalog: await readJson(required("catalog")),
  currentRun: await readJson(required("current-run")),
  recentCommits,
  buyLearning,
  buyEvidence,
  buyMarketHealth,
});
const output = required("output");
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ status: "PASS", output, tasks: snapshot.n2Tasks.length, blockers: snapshot.blockers.length, buyLearning: snapshot.buyLearning.status, buyEvidence: snapshot.buyEvidence.status, buyMarketHealth: snapshot.buyMarketHealth.status }));
