import { createHash } from "node:crypto";
import { access, cp, lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import {
  DEFAULT_PUBLIC_SNAPSHOT_FUTURE_SKEW_MS,
  verifyPublicDashboardSnapshotIntegrity,
} from "./publicSnapshotTransport";

export const PUBLIC_DEPLOY_MANIFEST_VERSION = "public-dashboard-deploy-manifest-v1";

export type PublicDeployManifest = {
  schemaVersion: typeof PUBLIC_DEPLOY_MANIFEST_VERSION;
  entry: "index.html";
  files: Array<{
    path: string;
    bytes: number;
    sha256: string;
  }>;
};

export type PublicDeployVerification = {
  ok: boolean;
  errors: string[];
  manifest: PublicDeployManifest | null;
};

const REQUIRED_ROOT_FILES = [
  "index.html",
  "404.html",
  "robots.txt",
  "manifest.webmanifest",
  "_headers",
  "_redirects",
  "deploy-manifest.json",
] as const;

const ALLOWED_ROOT_FILES = new Set<string>(REQUIRED_ROOT_FILES);
const OPTIONAL_PUBLIC_DATA_FILES = new Set([
  "public-data/latest.json",
  "public-data/last-known-good.json",
]);
const ALLOWED_ASSET_EXTENSIONS = new Set([
  ".css",
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".js",
  ".json",
  ".png",
  ".svg",
  ".webp",
  ".woff",
  ".woff2",
]);
const TEXT_EXTENSIONS = new Set([".css", ".html", ".json", ".txt", ".webmanifest"]);
const MAX_PUBLIC_FILE_BYTES = 8 * 1024 * 1024;
const FORBIDDEN_DATA_PATTERNS: Array<[string, RegExp]> = [
  ["owner API", /\/api\/owner/i],
  ["operational dashboard API", /\/api\/dashboard/i],
  ["SQLite client", /better-sqlite3|\bsqlite3\b/i],
  ["app settings", /app_settings/i],
  ["automation request path", /automation\/requests/i],
  ["operational database path", /data\/boat\.sqlite/i],
  ["local user path", /\/Users\//],
  ["source map reference", /sourceMappingURL=/i],
];
const FORBIDDEN_JAVASCRIPT_PATTERNS: Array<[string, RegExp]> = [
  ["owner API", /\/api\/owner/i],
  ["operational dashboard API", /\/api\/dashboard/i],
  ["SQLite client", /better-sqlite3|\bsqlite3\b/i],
  ["operational database path", /data\/boat\.sqlite/i],
  ["source map reference", /sourceMappingURL=/i],
];

export async function assemblePublicDashboardDeploy(options: {
  distDir: string;
  staticDir: string;
  outputDir: string;
  snapshotDir?: string | null;
}): Promise<PublicDeployManifest> {
  const distDir = resolve(options.distDir);
  const staticDir = resolve(options.staticDir);
  const outputDir = resolve(options.outputDir);

  assertDistinctDirectories(distDir, staticDir, outputDir);
  await requireDirectory(distDir, "distDir");
  await requireDirectory(staticDir, "staticDir");
  assertDistinctDirectories(
    await canonicalDirectoryTarget(distDir),
    await canonicalDirectoryTarget(staticDir),
    await canonicalDirectoryTarget(outputDir),
  );

  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
  await copyTreeWithoutSymlinks(distDir, outputDir);

  const viteEntry = join(outputDir, "public-dashboard.html");
  await requireFile(viteEntry, "isolated Vite public-dashboard.html entry");
  const indexPath = join(outputDir, "index.html");
  if (await pathExists(indexPath)) throw new Error("isolated public build unexpectedly contains index.html");
  await rename(viteEntry, indexPath);

  await copyTreeWithoutSymlinks(staticDir, outputDir);

  if (options.snapshotDir) {
    const snapshotDir = resolve(options.snapshotDir);
    await requireDirectory(snapshotDir, "snapshotDir");
    const target = join(outputDir, "public-data");
    await mkdir(target, { recursive: true });
    for (const name of ["latest.json", "last-known-good.json"] as const) {
      const source = join(snapshotDir, name);
      if (!await pathExists(source)) continue;
      const sourceInfo = await lstat(source);
      if (sourceInfo.isSymbolicLink() || !sourceInfo.isFile()) {
        throw new Error(`snapshot input must be a regular file: ${source}`);
      }
      await cp(source, join(target, name), { force: true });
    }
  }

  const manifest = await createManifest(outputDir);
  await writeFile(
    join(outputDir, "deploy-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  const verification = await verifyPublicDashboardDeploy(outputDir);
  if (!verification.ok) throw new Error(`public deploy verification failed:\n${verification.errors.join("\n")}`);
  return manifest;
}

export async function verifyPublicDashboardDeploy(directory: string): Promise<PublicDeployVerification> {
  const root = resolve(directory);
  const errors: string[] = [];

  try {
    await requireDirectory(root, "deploy directory");
  } catch (error) {
    return { ok: false, errors: [messageOf(error)], manifest: null };
  }

  const files = await listFiles(root);
  const fileSet = new Set(files);
  const regularFiles = new Set<string>();

  for (const required of REQUIRED_ROOT_FILES) {
    if (!fileSet.has(required)) errors.push(`missing required public file: ${required}`);
  }

  for (const path of files) {
    const absolute = join(root, ...path.split("/"));
    const info = await lstat(absolute);
    if (info.isSymbolicLink()) {
      errors.push(`symbolic links are forbidden: ${path}`);
      continue;
    }
    if (!info.isFile()) {
      errors.push(`non-regular public entry is forbidden: ${path}`);
      continue;
    }
    if (info.size > MAX_PUBLIC_FILE_BYTES) {
      errors.push(`public file exceeds 8 MiB: ${path}`);
      continue;
    }
    regularFiles.add(path);

    if (!isAllowedPublicPath(path)) errors.push(`non-allowlisted public file: ${path}`);
    if (path.endsWith(".map")) errors.push(`source maps are forbidden: ${path}`);
    if (/\.(?:db|sqlite|sqlite3|wal|shm|env)$/i.test(path)) errors.push(`private/runtime file is forbidden: ${path}`);

    const extension = extname(path);
    if (extension === ".js") {
      const text = await readFile(absolute, "utf8");
      scanForbiddenText(path, text, FORBIDDEN_JAVASCRIPT_PATTERNS, errors);
    } else if (TEXT_EXTENSIONS.has(extension) || basename(path).startsWith("_")) {
      const text = await readFile(absolute, "utf8");
      scanForbiddenText(path, text, FORBIDDEN_DATA_PATTERNS, errors);
    }
  }

  if (regularFiles.has("index.html")) {
    const index = await readFile(join(root, "index.html"), "utf8");
    if (!/id="public-root"/.test(index)) errors.push("index.html is not the public dashboard entry");
    if (/\/src\/public-main\.tsx/.test(index)) errors.push("index.html still references unbuilt TypeScript source");
    for (const assetPath of extractAbsoluteAssetReferences(index)) {
      if (!fileSet.has(assetPath)) errors.push(`index.html references missing asset: ${assetPath}`);
    }
  }

  await verifyOptionalSnapshots(root, regularFiles, errors);

  let manifest: PublicDeployManifest | null = null;
  if (regularFiles.has("deploy-manifest.json")) {
    try {
      manifest = JSON.parse(await readFile(join(root, "deploy-manifest.json"), "utf8")) as PublicDeployManifest;
      errors.push(...await validateManifest(root, manifest, files));
    } catch (error) {
      errors.push(`invalid deploy-manifest.json: ${messageOf(error)}`);
    }
  }

  return { ok: errors.length === 0, errors, manifest: errors.length === 0 ? manifest : null };
}

async function verifyOptionalSnapshots(root: string, files: Set<string>, errors: string[]): Promise<void> {
  const present = [...OPTIONAL_PUBLIC_DATA_FILES].filter((path) => files.has(path));
  if (present.length === 1) errors.push("latest.json and last-known-good.json must be published together");

  const nowMs = Date.now();
  const snapshots: Array<{ path: string; dataAsOf: number; generatedAt: number }> = [];
  for (const path of present) {
    try {
      const value = JSON.parse(await readFile(join(root, ...path.split("/")), "utf8")) as unknown;
      const verified = await verifyPublicDashboardSnapshotIntegrity(value);
      if (!verified.ok || !verified.snapshot) {
        errors.push(`${path} failed snapshot integrity verification`);
        continue;
      }
      const dataAsOf = Date.parse(verified.snapshot.dataAsOf);
      const generatedAt = Date.parse(verified.snapshot.generatedAt);
      if (!Number.isFinite(dataAsOf)) {
        errors.push(`${path} has an invalid dataAsOf`);
        continue;
      }
      if (!Number.isFinite(generatedAt)) {
        errors.push(`${path} has an invalid generatedAt`);
        continue;
      }
      if (generatedAt - nowMs > DEFAULT_PUBLIC_SNAPSHOT_FUTURE_SKEW_MS) {
        errors.push(`${path} generatedAt is in the future`);
        continue;
      }
      if (dataAsOf - nowMs > DEFAULT_PUBLIC_SNAPSHOT_FUTURE_SKEW_MS) {
        errors.push(`${path} dataAsOf is in the future`);
        continue;
      }
      if (dataAsOf > generatedAt + DEFAULT_PUBLIC_SNAPSHOT_FUTURE_SKEW_MS) {
        errors.push(`${path} dataAsOf is after generatedAt`);
        continue;
      }
      snapshots.push({ path, dataAsOf, generatedAt });
    } catch (error) {
      errors.push(`${path} is invalid JSON: ${messageOf(error)}`);
    }
  }

  const latest = snapshots.find((item) => item.path.endsWith("latest.json"));
  const fallback = snapshots.find((item) => item.path.endsWith("last-known-good.json"));
  if (latest && fallback && latest.dataAsOf < fallback.dataAsOf) {
    errors.push("latest.json is older than last-known-good.json");
  }
  if (
    latest
    && fallback
    && latest.dataAsOf === fallback.dataAsOf
    && latest.generatedAt < fallback.generatedAt
  ) {
    errors.push("latest.json generation is older than last-known-good.json");
  }
}

async function createManifest(root: string): Promise<PublicDeployManifest> {
  const files = (await listFiles(root)).filter((path) => path !== "deploy-manifest.json");
  const entries: PublicDeployManifest["files"] = [];
  for (const path of files) {
    const absolute = join(root, ...path.split("/"));
    const content = await readFile(absolute);
    entries.push({
      path,
      bytes: content.byteLength,
      sha256: createHash("sha256").update(content).digest("hex"),
    });
  }
  return {
    schemaVersion: PUBLIC_DEPLOY_MANIFEST_VERSION,
    entry: "index.html",
    files: entries.sort((a, b) => a.path.localeCompare(b.path)),
  };
}

async function validateManifest(root: string, manifest: PublicDeployManifest, actualFiles: string[]): Promise<string[]> {
  const errors: string[] = [];
  if (manifest.schemaVersion !== PUBLIC_DEPLOY_MANIFEST_VERSION) errors.push("unsupported deploy manifest schema");
  if (manifest.entry !== "index.html") errors.push("deploy manifest entry must be index.html");
  if (!Array.isArray(manifest.files)) return [...errors, "deploy manifest files must be an array"];

  const expectedPaths = actualFiles.filter((path) => path !== "deploy-manifest.json").sort();
  const validEntries: PublicDeployManifest["files"] = [];
  for (const entry of manifest.files) {
    if (!entry || typeof entry.path !== "string") {
      errors.push("deploy manifest contains an invalid file entry");
      continue;
    }
    if (!isSafeRelativePath(entry.path)) {
      errors.push(`deploy manifest contains an unsafe path: ${entry.path}`);
      continue;
    }
    if (!expectedPaths.includes(entry.path)) {
      errors.push(`deploy manifest references a non-artifact path: ${entry.path}`);
      continue;
    }
    if (!Number.isInteger(entry.bytes) || entry.bytes < 0) {
      errors.push(`deploy manifest contains invalid bytes: ${entry.path}`);
      continue;
    }
    if (!/^[a-f0-9]{64}$/.test(entry.sha256)) {
      errors.push(`deploy manifest contains invalid digest: ${entry.path}`);
      continue;
    }
    validEntries.push(entry);
  }

  const manifestPaths = validEntries.map((file) => file.path).sort();
  if (new Set(manifestPaths).size !== manifestPaths.length) errors.push("deploy manifest contains duplicate paths");
  if (JSON.stringify(expectedPaths) !== JSON.stringify(manifestPaths)) {
    errors.push("deploy manifest file set does not match artifact contents");
  }

  for (const entry of validEntries) {
    const absolute = join(root, ...entry.path.split("/"));
    const info = await lstat(absolute);
    if (info.isSymbolicLink() || !info.isFile()) {
      errors.push(`manifest file must be a regular file: ${entry.path}`);
      continue;
    }
    if (info.size > MAX_PUBLIC_FILE_BYTES) continue;
    const content = await readFile(absolute);
    const digest = createHash("sha256").update(content).digest("hex");
    if (entry.bytes !== content.byteLength) errors.push(`manifest byte count mismatch: ${entry.path}`);
    if (entry.sha256 !== digest) errors.push(`manifest digest mismatch: ${entry.path}`);
  }
  return errors;
}

function isAllowedPublicPath(path: string): boolean {
  if (!path.includes("/")) return ALLOWED_ROOT_FILES.has(path);
  if (OPTIONAL_PUBLIC_DATA_FILES.has(path)) return true;
  if (!path.startsWith("assets/")) return false;
  return ALLOWED_ASSET_EXTENSIONS.has(extname(path));
}

function isSafeRelativePath(path: string): boolean {
  if (!path || path.startsWith("/") || path.includes("\\")) return false;
  const parts = path.split("/");
  return parts.every((part) => part !== "" && part !== "." && part !== "..");
}

function extractAbsoluteAssetReferences(html: string): string[] {
  const references = new Set<string>();
  for (const match of html.matchAll(/(?:src|href)="\/([^"#?]+)(?:[?#][^"]*)?"/g)) {
    const path = match[1];
    if (path) references.add(path);
  }
  return [...references];
}

function scanForbiddenText(
  path: string,
  text: string,
  patterns: Array<[string, RegExp]>,
  errors: string[],
): void {
  for (const [label, pattern] of patterns) {
    if (pattern.test(text)) errors.push(`${path} contains forbidden ${label}`);
  }
}

async function copyTreeWithoutSymlinks(source: string, destination: string): Promise<void> {
  const entries = await readdir(source, { withFileTypes: true });
  await mkdir(destination, { recursive: true });
  for (const entry of entries) {
    const sourcePath = join(source, entry.name);
    const destinationPath = join(destination, entry.name);
    const info = await lstat(sourcePath);
    if (info.isSymbolicLink()) throw new Error(`refusing to copy symbolic link: ${sourcePath}`);
    if (entry.isDirectory()) await copyTreeWithoutSymlinks(sourcePath, destinationPath);
    else if (entry.isFile()) await cp(sourcePath, destinationPath, { force: true });
    else throw new Error(`unsupported public build entry: ${sourcePath}`);
  }
}

async function listFiles(root: string): Promise<string[]> {
  const output: string[] = [];
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = join(directory, entry.name);
      const path = relative(root, absolute).split(sep).join("/");
      if (entry.isDirectory()) await visit(absolute);
      else output.push(path);
    }
  }
  await visit(root);
  return output.sort();
}

function assertDistinctDirectories(...directories: string[]): void {
  const unique = new Set(directories.map((directory) => resolve(directory)));
  if (unique.size !== directories.length) throw new Error("dist, static and output directories must be distinct");
  for (const left of unique) {
    for (const right of unique) {
      if (left === right) continue;
      if (left.startsWith(`${right}${sep}`) || right.startsWith(`${left}${sep}`)) {
        throw new Error("dist, static and output directories must not contain one another");
      }
    }
  }
}

async function canonicalDirectoryTarget(path: string): Promise<string> {
  const unresolved = [basename(path)];
  let parent = dirname(path);

  while (true) {
    try {
      return join(await realpath(parent), ...unresolved);
    } catch (error) {
      if (!isEnoent(error)) throw error;
      const nextParent = dirname(parent);
      if (nextParent === parent) throw error;
      unresolved.unshift(basename(parent));
      parent = nextParent;
    }
  }
}

function isEnoent(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === "ENOENT";
}

async function requireDirectory(path: string, label: string): Promise<void> {
  const info = await lstat(path);
  if (info.isSymbolicLink()) throw new Error(`${label} must not be a symbolic link: ${path}`);
  if (!info.isDirectory()) throw new Error(`${label} is not a directory: ${path}`);
}

async function requireFile(path: string, label: string): Promise<void> {
  const info = await stat(path);
  if (!info.isFile()) throw new Error(`${label} is not a file: ${path}`);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
