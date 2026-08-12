/** 公式出典付き選手関係registryの構造と安全条件を検査する。ネットワーク・DBは変更しない。 */
import { readFileSync } from "node:fs";

type Person = { registrationNo: string; name: string };
type Relationship = {
  relationshipType: string;
  mentor: Person;
  apprentice: Person;
  sourceUrl: string;
  sourcePublishedDate: string;
  evidenceSummary: string;
  verifiedAt: string;
};
type Registry = {
  schemaVersion: number;
  policy: { allowedRelationshipTypes: string[]; sourcePolicy: string; analysisPolicy: string };
  relationships: Relationship[];
};

const path = "docs/official-racer-relationships.json";
const registry = JSON.parse(readFileSync(path, "utf8")) as Registry;
const errors: string[] = [];
const seen = new Set<string>();

if (registry.schemaVersion !== 1) errors.push("schemaVersion must be 1");
if (!registry.policy?.analysisPolicy.includes("個人別の疑惑判定には使わない")) {
  errors.push("analysis policy must prohibit person-level suspicion scoring");
}
if (!Array.isArray(registry.relationships) || registry.relationships.length === 0) {
  errors.push("relationships must be a non-empty array");
}

for (const [index, row] of (registry.relationships ?? []).entries()) {
  const label = `relationships[${index}]`;
  if (!registry.policy.allowedRelationshipTypes.includes(row.relationshipType)) errors.push(`${label}: unsupported relationshipType`);
  for (const [role, person] of [["mentor", row.mentor], ["apprentice", row.apprentice]] as const) {
    if (!/^\d{4}$/.test(person?.registrationNo ?? "")) errors.push(`${label}.${role}: registrationNo must be 4 digits`);
    if (!(person?.name ?? "").trim()) errors.push(`${label}.${role}: name is required`);
  }
  if (row.mentor?.registrationNo === row.apprentice?.registrationNo) errors.push(`${label}: self relationship is forbidden`);
  if (!/^https:\/\/www\.boatrace\.jp\//.test(row.sourceUrl ?? "")) errors.push(`${label}: source must be BOAT RACE official HTTPS URL`);
  if (!isDate(row.sourcePublishedDate)) errors.push(`${label}: invalid sourcePublishedDate`);
  if (!isDate(row.verifiedAt)) errors.push(`${label}: invalid verifiedAt`);
  if (!(row.evidenceSummary ?? "").includes("公式記事")) errors.push(`${label}: evidenceSummary must identify official evidence`);
  const key = [row.relationshipType, row.mentor?.registrationNo, row.apprentice?.registrationNo].join(":");
  if (seen.has(key)) errors.push(`${label}: duplicate relationship ${key}`);
  seen.add(key);
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`official relationship registry: ok (${registry.relationships.length} relationships)`);
}

function isDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}
