import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const policyPath = resolve(repoRoot, "config/product-boundary-policy.json");

const fail = (message) => {
  console.error(`::error::${message}`);
  process.exitCode = 1;
};

if (!existsSync(policyPath)) {
  fail("missing config/product-boundary-policy.json");
  process.exit();
}

let policy;
try {
  policy = JSON.parse(readFileSync(policyPath, "utf8"));
} catch (error) {
  fail(`invalid product boundary policy JSON: ${error instanceof Error ? error.message : String(error)}`);
  process.exit();
}

const requiredArrays = [
  "publicBrowserFiles",
  "publicSourceFiles",
  "publicSourceRoots",
  "optionalPaths",
  "allowedBrowserImportPatterns",
  "forbiddenImportFragments",
  "forbiddenBrowserPatterns",
  "protectedAuthoritativePaths",
  "requiredPrinciples",
];

if (policy.schemaVersion !== "product-boundary-policy-v1") {
  fail(`unsupported product boundary policy version: ${String(policy.schemaVersion)}`);
}

for (const key of requiredArrays) {
  if (!Array.isArray(policy[key])) fail(`policy.${key} must be an array`);
}

if (process.exitCode) process.exit();

const authorityPath = resolve(repoRoot, policy.authority ?? "");
if (!policy.authority || !existsSync(authorityPath)) {
  fail(`missing boundary authority document: ${String(policy.authority)}`);
}

const toPosix = (value) => value.split(sep).join("/");
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const optionalPaths = new Set(policy.optionalPaths.map((value) => toPosix(value)));

function collectSourceFiles(pathFromRoot) {
  const absolutePath = resolve(repoRoot, pathFromRoot);
  const normalizedPath = toPosix(pathFromRoot);

  if (!existsSync(absolutePath)) {
    if (!optionalPaths.has(normalizedPath)) fail(`required public path is missing: ${normalizedPath}`);
    return [];
  }

  const stats = statSync(absolutePath);
  if (stats.isFile()) return sourceExtensions.has(extname(absolutePath)) ? [absolutePath] : [];

  const files = [];
  for (const entry of readdirSync(absolutePath)) {
    const child = resolve(absolutePath, entry);
    const childStats = statSync(child);
    if (childStats.isDirectory()) {
      if (entry === "node_modules" || entry === "dist" || entry === "coverage") continue;
      files.push(...collectSourceFiles(toPosix(relative(repoRoot, child))));
    } else if (sourceExtensions.has(extname(child))) {
      files.push(child);
    }
  }
  return files;
}

function extractImports(source) {
  const imports = new Set();
  const patterns = [
    /\bfrom\s+["'`]([^"'`]+)["'`]/g,
    /\bimport\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g,
    /\bimport\s+["'`]([^"'`]+)["'`]/g,
    /\brequire\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) imports.add(match[1]);
  }
  return [...imports];
}

const publicFiles = new Set();
for (const root of policy.publicSourceRoots) {
  for (const file of collectSourceFiles(root)) publicFiles.add(file);
}
for (const file of [...policy.publicSourceFiles, ...policy.publicBrowserFiles]) {
  const absolutePath = resolve(repoRoot, file);
  if (!existsSync(absolutePath)) {
    fail(`required declared public source is missing: ${file}`);
  } else if (!sourceExtensions.has(extname(absolutePath))) {
    fail(`declared public source has unsupported extension: ${file}`);
  } else {
    publicFiles.add(absolutePath);
  }
}

const forbiddenImportFragments = policy.forbiddenImportFragments.map((value) => value.toLowerCase());
const allowedBrowserImports = policy.allowedBrowserImportPatterns.map((pattern) => new RegExp(pattern));
const browserPatterns = policy.forbiddenBrowserPatterns.map(({ id, pattern }) => ({
  id,
  regex: new RegExp(pattern, "i"),
}));
const browserFileSet = new Set(policy.publicBrowserFiles.map((file) => resolve(repoRoot, file)));

for (const absolutePath of publicFiles) {
  const pathFromRoot = toPosix(relative(repoRoot, absolutePath));
  const source = readFileSync(absolutePath, "utf8");
  const imports = extractImports(source);

  for (const specifier of imports) {
    const normalizedSpecifier = specifier.toLowerCase();
    const forbiddenFragment = forbiddenImportFragments.find((fragment) => normalizedSpecifier.includes(fragment));
    if (forbiddenFragment) {
      fail(`${pathFromRoot} imports protected dependency '${specifier}' (matched '${forbiddenFragment}')`);
    }
  }

  if (!browserFileSet.has(absolutePath)) continue;

  for (const specifier of imports) {
    if (!allowedBrowserImports.some((pattern) => pattern.test(specifier))) {
      fail(`${pathFromRoot} has non-allowlisted browser import '${specifier}'`);
    }
  }

  for (const { id, regex } of browserPatterns) {
    if (regex.test(source)) fail(`${pathFromRoot} violates browser boundary ${id}`);
  }
}

const normalizedPublicPaths = [
  ...policy.publicSourceRoots,
  ...policy.publicSourceFiles,
  ...policy.publicBrowserFiles,
].map((value) => `${toPosix(value).replace(/\/$/, "")}/`);

for (const protectedPath of policy.protectedAuthoritativePaths) {
  const normalizedProtected = `${toPosix(protectedPath).replace(/\/$/, "")}/`;
  if (normalizedPublicPaths.some((publicPath) => (
    publicPath.startsWith(normalizedProtected) || normalizedProtected.startsWith(publicPath)
  ))) {
    fail(`public/protected path overlap: ${protectedPath}`);
  }
}

if (policy.requiredPrinciples.length < 6) {
  fail("boundary policy must preserve all required one-way principles");
}

if (!process.exitCode) {
  console.log(`product boundary check passed (${publicFiles.size} declared public source files scanned)`);
  console.log("LINE/Current BUY remain upstream of optional public publication by policy.");
}
