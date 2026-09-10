/**
 * audit-all-bet-type-data-feasibility.ts — research-only guarded entrypoint
 *
 * Keeps the Phase N0 feasibility audit isolated from production behavior while
 * validating the research DB identity immediately before the legacy read-only
 * implementation runs. Persisted reports must use opaque DB provenance.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { assertCanonicalSingleLinkRegularFile } from "../src/research-replay/researchFileIdentity";

const REPORT_JSON = "reports/all-bet-type-data-feasibility.json";
const REPORT_MD = "reports/all-bet-type-data-feasibility.md";
const OPAQUE_DB_SOURCE = "canonical research database";

const configuredDbPath = process.env.BOAT_PON_DB_PATH ?? "data/boat.sqlite";
if (!existsSync(configuredDbPath)) {
  throw new Error("ALL_BET_TYPE_FEASIBILITY_RESEARCH_DB_UNAVAILABLE");
}

const verifiedDbPath = assertCanonicalSingleLinkRegularFile(
  configuredDbPath,
  "ALL_BET_TYPE_FEASIBILITY_DB_IDENTITY_INVALID",
);
process.env.BOAT_PON_DB_PATH = verifiedDbPath;

await import("./audit-all-bet-type-data-feasibility-internal");

if (!existsSync(REPORT_JSON) || !existsSync(REPORT_MD)) {
  throw new Error("ALL_BET_TYPE_FEASIBILITY_REPORT_MISSING_AFTER_AUDIT");
}

const parsed = JSON.parse(readFileSync(REPORT_JSON, "utf8")) as {
  safety?: { dbPath?: unknown };
};
if (!parsed.safety || parsed.safety.dbPath !== verifiedDbPath) {
  throw new Error("ALL_BET_TYPE_FEASIBILITY_DB_PROVENANCE_UNEXPECTED");
}
parsed.safety.dbPath = OPAQUE_DB_SOURCE;
const sanitizedJson = `${JSON.stringify(parsed, null, 2)}\n`;
if (sanitizedJson.includes(verifiedDbPath)) {
  throw new Error("ALL_BET_TYPE_FEASIBILITY_PRIVATE_DB_PROVENANCE_REMAINED");
}
writeFileSync(REPORT_JSON, sanitizedJson);

const markdown = readFileSync(REPORT_MD, "utf8");
if (!markdown.includes(verifiedDbPath)) {
  throw new Error("ALL_BET_TYPE_FEASIBILITY_MARKDOWN_DB_PROVENANCE_NOT_FOUND");
}
const sanitizedMarkdown = markdown.replaceAll(verifiedDbPath, OPAQUE_DB_SOURCE);
if (sanitizedMarkdown.includes(verifiedDbPath)) {
  throw new Error("ALL_BET_TYPE_FEASIBILITY_PRIVATE_DB_PROVENANCE_REMAINED");
}
writeFileSync(REPORT_MD, sanitizedMarkdown);

console.log("[all-bet-type-feasibility] PASS: canonical DB identity verified and persisted provenance redacted");
