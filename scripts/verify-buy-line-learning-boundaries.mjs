import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

const root = process.cwd();
const policyPath = resolve(root, "config/buy-line-learning-boundary-policy.json");
const errors = [];

function report(message) {
  errors.push(message);
  console.error(`::error::${message}`);
}

function readUtf8(path) {
  return readFileSync(resolve(root, path), "utf8");
}

function normalize(value) {
  return value.replaceAll("\\", "/");
}

function importSpecifiers(source) {
  const result = [];
  const patterns = [
    /(?:import|export)\s+(?:[^"'()]*?\s+from\s+)?["']([^"']+)["']/g,
    /import\(\s*["']([^"']+)["']\s*\)/g,
    /require\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) result.push(match[1]);
  }
  return [...new Set(result)];
}

function sourceFilesUnder(path) {
  const absolute = resolve(root, path);
  if (!existsSync(absolute)) return [];
  const files = [];
  const visit = (current) => {
    const stat = statSync(current);
    if (stat.isDirectory()) {
      for (const entry of readdirSync(current).sort()) visit(join(current, entry));
      return;
    }
    if (![".ts", ".tsx", ".js", ".mjs", ".cjs"].includes(extname(current))) return;
    files.push(normalize(relative(root, current)));
  };
  visit(absolute);
  return files;
}

if (!existsSync(policyPath)) {
  report("missing boundary policy: config/buy-line-learning-boundary-policy.json");
} else {
  const policy = JSON.parse(readFileSync(policyPath, "utf8"));

  if (policy.policyVersion !== "buy-line-learning-boundary-v1") {
    report(`unsupported policyVersion: ${String(policy.policyVersion)}`);
  }

  for (const requiredFile of policy.requiredFiles ?? []) {
    if (!existsSync(resolve(root, requiredFile))) report(`missing required safe-growth file: ${requiredFile}`);
  }

  const roadmapPath = policy.authorityRoadmap;
  if (!roadmapPath || !existsSync(resolve(root, roadmapPath))) {
    report(`missing authority roadmap: ${String(roadmapPath)}`);
  } else {
    const roadmap = readUtf8(roadmapPath);
    for (const marker of policy.requiredRoadmapMarkers ?? []) {
      if (!roadmap.includes(marker)) report(`authority roadmap missing required marker: ${marker}`);
    }
  }

  for (const protectedFile of policy.protectedOperationalFiles ?? []) {
    const absolute = resolve(root, protectedFile);
    if (!existsSync(absolute)) {
      report(`protected operational file not found: ${protectedFile}`);
      continue;
    }
    const imports = importSpecifiers(readFileSync(absolute, "utf8"));
    for (const specifier of imports) {
      const normalizedSpecifier = normalize(specifier).toLowerCase();
      for (const fragment of policy.forbiddenOperationalImportFragments ?? []) {
        if (normalizedSpecifier.includes(String(fragment).toLowerCase())) {
          report(`${protectedFile} imports lower-priority research/public dependency: ${specifier}`);
        }
      }
    }
  }

  const researchFiles = [...new Set(
    (policy.researchRoots ?? []).flatMap((path) => sourceFilesUnder(path)),
  )].sort();
  for (const researchFile of researchFiles) {
    const imports = importSpecifiers(readUtf8(researchFile));
    for (const specifier of imports) {
      const normalizedSpecifier = normalize(specifier).toLowerCase();
      for (const fragment of policy.forbiddenResearchImportFragments ?? []) {
        if (normalizedSpecifier.includes(String(fragment).toLowerCase())) {
          report(`${researchFile} imports protected BUY/LINE/production dependency: ${specifier}`);
        }
      }
    }
  }
}

if (errors.length > 0) {
  console.error(`BUY/LINE learning boundary verification failed with ${errors.length} problem(s).`);
  process.exit(1);
}

console.log("BUY/LINE learning boundary verification passed.");
