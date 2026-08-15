import { createHash } from "node:crypto";
import { access, cp, lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { validateOwnerDashboardSnapshot } from "./ownerDashboardSnapshot";
import {
  DEFAULT_PUBLIC_SNAPSHOT_FUTURE_SKEW_MS,
  verifyPublicDashboardSnapshotIntegrity,
} from "./publicSnapshotTransport";

export const PUBLIC_DEPLOY_MANIFEST_VERSION = "public-dashboard-deploy-manifest-v1";

export type PublicDeployManifest = {
  schemaVersion: typeof PUBLIC_DEPLOY_MANIFEST_VERSION;
  entry: "index.html";
  files: Array<{ path: string; bytes: number; sha256: string }>;
};
export type PublicDeployVerification = { ok: boolean; errors: string[]; manifest: PublicDeployManifest | null };

const REQUIRED_ROOT_FILES = ["index.html", "404.html", "robots.txt", "manifest.webmanifest", "_headers", "_redirects", "deploy-manifest.json"] as const;
const ALLOWED_ROOT_FILES = new Set<string>(REQUIRED_ROOT_FILES);
const RESEARCH_PUBLIC_DATA_FILES = new Set(["public-data/latest.json", "public-data/last-known-good.json"]);
const OWNER_PUBLIC_DATA_FILE = "public-data/owner-latest.json";
const OPTIONAL_PUBLIC_DATA_FILES = new Set([...RESEARCH_PUBLIC_DATA_FILES, OWNER_PUBLIC_DATA_FILE]);
const SNAPSHOT_NAMES = ["latest.json", "last-known-good.json", "owner-latest.json"] as const;
const ALLOWED_ASSET_EXTENSIONS = new Set([".css", ".gif", ".ico", ".jpeg", ".jpg", ".js", ".json", ".png", ".svg", ".webp", ".woff", ".woff2"]);
const TEXT_EXTENSIONS = new Set([".css", ".html", ".json", ".txt", ".webmanifest"]);
const MAX_PUBLIC_FILE_BYTES = 8 * 1024 * 1024;
const FORBIDDEN_DATA_PATTERNS: Array<[string, RegExp]> = [
  ["owner API", /\/api\/owner/i], ["operational dashboard API", /\/api\/dashboard/i], ["SQLite client", /better-sqlite3|\bsqlite3\b/i], ["app settings", /app_settings/i], ["automation request path", /automation\/requests/i], ["operational database path", /data\/boat\.sqlite/i], ["local user path", /\/Users\//], ["source map reference", /sourceMappingURL=/i],
];
const FORBIDDEN_JAVASCRIPT_PATTERNS: Array<[string, RegExp]> = [
  ["owner API", /\/api\/owner/i], ["operational dashboard API", /\/api\/dashboard/i], ["SQLite client", /better-sqlite3|\bsqlite3\b/i], ["operational database path", /data\/boat\.sqlite/i], ["source map reference", /sourceMappingURL=/i],
];

export async function assemblePublicDashboardDeploy(options: { distDir: string; staticDir: string; outputDir: string; snapshotDir?: string | null }): Promise<PublicDeployManifest> {
  const distDir = resolve(options.distDir), staticDir = resolve(options.staticDir), outputDir = resolve(options.outputDir), snapshotDir = options.snapshotDir ? resolve(options.snapshotDir) : null;
  assertDistinctDirectories(distDir, staticDir, outputDir);
  await requireDirectory(distDir, "distDir"); await requireDirectory(staticDir, "staticDir");
  const canonicalDistDir = await canonicalDirectoryTarget(distDir), canonicalStaticDir = await canonicalDirectoryTarget(staticDir), canonicalOutputDir = await canonicalDirectoryTarget(outputDir);
  assertDistinctDirectories(canonicalDistDir, canonicalStaticDir, canonicalOutputDir);
  if (snapshotDir) {
    await requireDirectory(snapshotDir, "snapshotDir");
    assertSnapshotDirectoryIsolation(snapshotDir, distDir, staticDir, outputDir);
    assertSnapshotDirectoryIsolation(await canonicalDirectoryTarget(snapshotDir), canonicalDistDir, canonicalStaticDir, canonicalOutputDir);
    await validateSnapshotInputs(snapshotDir); await validateSnapshotSemantics(snapshotDir);
  }
  await validateCopyTreeSource(distDir); await validateCopyTreeSource(staticDir);
  const sourceViteEntry = join(distDir, "public-dashboard.html"); await requireFile(sourceViteEntry, "isolated Vite public-dashboard.html entry");
  if (await pathExists(join(distDir, "index.html"))) throw new Error("isolated public build unexpectedly contains index.html");
  await assertNoDeployDestinationCollisions(distDir, staticDir, snapshotDir);

  await rm(outputDir, { recursive: true, force: true }); await mkdir(outputDir, { recursive: true }); await copyTreeWithoutSymlinks(distDir, outputDir);
  const viteEntry = join(outputDir, "public-dashboard.html"); await requireFile(viteEntry, "isolated Vite public-dashboard.html entry");
  const indexPath = join(outputDir, "index.html"); if (await pathExists(indexPath)) throw new Error("isolated public build unexpectedly contains index.html"); await rename(viteEntry, indexPath);
  await copyTreeWithoutSymlinks(staticDir, outputDir);
  if (snapshotDir) {
    const target = join(outputDir, "public-data"); await mkdir(target, { recursive: true });
    for (const name of SNAPSHOT_NAMES) {
      const source = join(snapshotDir, name); let sourceInfo;
      try { sourceInfo = await lstat(source); } catch (error) { if (isEnoent(error)) continue; throw error; }
      if (sourceInfo.isSymbolicLink() || !sourceInfo.isFile()) throw new Error(`snapshot input must be a regular file: ${source}`);
      if (sourceInfo.size > MAX_PUBLIC_FILE_BYTES) throw new Error(`refusing to copy oversized public snapshot: ${source}`);
      await cp(source, join(target, name), { force: true });
    }
  }
  const manifest = await createManifest(outputDir); await writeFile(join(outputDir, "deploy-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const verification = await verifyPublicDashboardDeploy(outputDir); if (!verification.ok) throw new Error(`public deploy verification failed:\n${verification.errors.join("\n")}`); return manifest;
}

export async function verifyPublicDashboardDeploy(directory: string): Promise<PublicDeployVerification> {
  const root = resolve(directory), errors: string[] = [];
  try { await requireDirectory(root, "deploy directory"); } catch (error) { return { ok: false, errors: [messageOf(error)], manifest: null }; }
  const files = await listFiles(root), fileSet = new Set(files), regularFiles = new Set<string>();
  for (const required of REQUIRED_ROOT_FILES) if (!fileSet.has(required)) errors.push(`missing required public file: ${required}`);
  for (const path of files) {
    const absolute = join(root, ...path.split("/")); const info = await lstat(absolute);
    if (info.isSymbolicLink()) { errors.push(`symbolic links are forbidden: ${path}`); continue; }
    if (!info.isFile()) { errors.push(`non-regular public entry is forbidden: ${path}`); continue; }
    if (info.size > MAX_PUBLIC_FILE_BYTES) { errors.push(`public file exceeds 8 MiB: ${path}`); continue; }
    regularFiles.add(path);
    if (!isAllowedPublicPath(path)) errors.push(`non-allowlisted public file: ${path}`);
    if (path.endsWith(".map")) errors.push(`source maps are forbidden: ${path}`);
    if (/\.(?:db|sqlite|sqlite3|wal|shm|env)$/i.test(path)) errors.push(`private/runtime file is forbidden: ${path}`);
    const extension = extname(path);
    if (extension === ".js") scanForbiddenText(path, await readFile(absolute, "utf8"), FORBIDDEN_JAVASCRIPT_PATTERNS, errors);
    else if (TEXT_EXTENSIONS.has(extension) || basename(path).startsWith("_")) scanForbiddenText(path, await readFile(absolute, "utf8"), FORBIDDEN_DATA_PATTERNS, errors);
  }
  if (regularFiles.has("index.html")) {
    const index = await readFile(join(root, "index.html"), "utf8");
    if (!/id="public-root"/.test(index)) errors.push("index.html is not the public dashboard entry");
    if (/\/src\/public-main\.tsx/.test(index)) errors.push("index.html still references unbuilt TypeScript source");
    for (const assetPath of extractAbsoluteAssetReferences(index)) if (!fileSet.has(assetPath)) errors.push(`index.html references missing asset: ${assetPath}`);
  }
  await verifyOptionalSnapshots(root, regularFiles, errors);
  let manifest: PublicDeployManifest | null = null;
  if (regularFiles.has("deploy-manifest.json")) {
    try { manifest = JSON.parse(await readFile(join(root, "deploy-manifest.json"), "utf8")) as PublicDeployManifest; errors.push(...await validateManifest(root, manifest, files)); }
    catch (error) { errors.push(`invalid deploy-manifest.json: ${messageOf(error)}`); }
  }
  return { ok: errors.length === 0, errors, manifest: errors.length === 0 ? manifest : null };
}

async function verifyOptionalSnapshots(root: string, files: Set<string>, errors: string[]): Promise<void> {
  const researchPresent = [...RESEARCH_PUBLIC_DATA_FILES].filter((path) => files.has(path));
  if (researchPresent.length === 1) errors.push("latest.json and last-known-good.json must be published together");
  const nowMs = Date.now(); const snapshots: Array<{ path: string; dataAsOf: number; generatedAt: number }> = [];
  for (const path of researchPresent) {
    try {
      const value = JSON.parse(await readFile(join(root, ...path.split("/")), "utf8")) as unknown; const verified = await verifyPublicDashboardSnapshotIntegrity(value);
      if (!verified.ok || !verified.snapshot) { errors.push(`${path} failed snapshot integrity verification`); continue; }
      const dataAsOf = Date.parse(verified.snapshot.dataAsOf), generatedAt = Date.parse(verified.snapshot.generatedAt);
      if (!Number.isFinite(dataAsOf)) { errors.push(`${path} has an invalid dataAsOf`); continue; }
      if (!Number.isFinite(generatedAt)) { errors.push(`${path} has an invalid generatedAt`); continue; }
      if (generatedAt - nowMs > DEFAULT_PUBLIC_SNAPSHOT_FUTURE_SKEW_MS) { errors.push(`${path} generatedAt is in the future`); continue; }
      if (dataAsOf - nowMs > DEFAULT_PUBLIC_SNAPSHOT_FUTURE_SKEW_MS) { errors.push(`${path} dataAsOf is in the future`); continue; }
      if (dataAsOf > generatedAt + DEFAULT_PUBLIC_SNAPSHOT_FUTURE_SKEW_MS) { errors.push(`${path} dataAsOf is after generatedAt`); continue; }
      snapshots.push({ path, dataAsOf, generatedAt });
    } catch (error) { errors.push(`${path} is invalid JSON: ${messageOf(error)}`); }
  }
  const latest = snapshots.find((item) => item.path.endsWith("latest.json")), fallback = snapshots.find((item) => item.path.endsWith("last-known-good.json"));
  if (latest && fallback && latest.dataAsOf < fallback.dataAsOf) errors.push("latest.json is older than last-known-good.json");
  if (latest && fallback && latest.dataAsOf === fallback.dataAsOf && latest.generatedAt < fallback.generatedAt) errors.push("latest.json generation is older than last-known-good.json");
  if (files.has(OWNER_PUBLIC_DATA_FILE)) {
    try {
      const value = JSON.parse(await readFile(join(root, ...OWNER_PUBLIC_DATA_FILE.split("/")), "utf8")) as unknown;
      const ownerErrors = validateOwnerDashboardSnapshot(value); if (ownerErrors.length) errors.push(`${OWNER_PUBLIC_DATA_FILE} failed owner schema verification: ${ownerErrors.join(";")}`);
      else { const generatedAt = Date.parse((value as { generatedAt: string }).generatedAt); if (generatedAt - nowMs > DEFAULT_PUBLIC_SNAPSHOT_FUTURE_SKEW_MS) errors.push(`${OWNER_PUBLIC_DATA_FILE} generatedAt is in the future`); }
    } catch (error) { errors.push(`${OWNER_PUBLIC_DATA_FILE} is invalid JSON: ${messageOf(error)}`); }
  }
}

async function createManifest(root: string): Promise<PublicDeployManifest> { const files = (await listFiles(root)).filter((path) => path !== "deploy-manifest.json"); const entries: PublicDeployManifest["files"] = []; for (const path of files) { const content = await readFile(join(root, ...path.split("/"))); entries.push({ path, bytes: content.byteLength, sha256: createHash("sha256").update(content).digest("hex") }); } return { schemaVersion: PUBLIC_DEPLOY_MANIFEST_VERSION, entry: "index.html", files: entries.sort((a,b)=>a.path.localeCompare(b.path)) }; }
async function validateManifest(root: string, manifest: PublicDeployManifest, actualFiles: string[]): Promise<string[]> {
  const errors: string[] = [];
  if (manifest.schemaVersion !== PUBLIC_DEPLOY_MANIFEST_VERSION) errors.push("unsupported deploy manifest schema");
  if (manifest.entry !== "index.html") errors.push("deploy manifest entry must be index.html");
  if (!Array.isArray(manifest.files)) return [...errors, "deploy manifest files must be an array"];
  const expectedPaths = actualFiles.filter((path)=>path!=="deploy-manifest.json").sort(), validEntries: PublicDeployManifest["files"] = [];
  for (const entry of manifest.files) {
    if (!entry || typeof entry.path !== "string") { errors.push("deploy manifest contains an invalid file entry"); continue; }
    if (!isSafeRelativePath(entry.path)) { errors.push(`deploy manifest contains an unsafe path: ${entry.path}`); continue; }
    if (!expectedPaths.includes(entry.path)) { errors.push(`deploy manifest references a non-artifact path: ${entry.path}`); continue; }
    if (!Number.isInteger(entry.bytes) || entry.bytes < 0) { errors.push(`deploy manifest contains invalid bytes: ${entry.path}`); continue; }
    if (!/^[a-f0-9]{64}$/.test(entry.sha256)) { errors.push(`deploy manifest contains invalid digest: ${entry.path}`); continue; }
    validEntries.push(entry);
  }
  const manifestPaths=validEntries.map(f=>f.path).sort();
  if(new Set(manifestPaths).size!==manifestPaths.length) errors.push("deploy manifest contains duplicate paths");
  if(JSON.stringify(expectedPaths)!==JSON.stringify(manifestPaths)) errors.push("deploy manifest file set does not match artifact contents");
  for(const entry of validEntries){
    const absolute = join(root,...entry.path.split("/"));
    const info = await lstat(absolute);
    if (info.isSymbolicLink() || !info.isFile()) { errors.push(`manifest file must be a regular file: ${entry.path}`); continue; }
    if (info.size > MAX_PUBLIC_FILE_BYTES) continue;
    const content=await readFile(absolute);
    if(entry.bytes!==content.byteLength) errors.push(`manifest byte count mismatch: ${entry.path}`);
    if(entry.sha256!==createHash("sha256").update(content).digest("hex")) errors.push(`manifest digest mismatch: ${entry.path}`);
  }
  return errors;
}
function isAllowedPublicPath(path:string){ if(!path.includes("/")) return ALLOWED_ROOT_FILES.has(path); if(OPTIONAL_PUBLIC_DATA_FILES.has(path)) return true; if(!path.startsWith("assets/")) return false; return ALLOWED_ASSET_EXTENSIONS.has(extname(path)); }
function isSafeRelativePath(path:string){ return !!path && !path.startsWith("/") && !path.includes("\\") && path.split("/").every((part)=>part!==""&&part!=="."&&part!==".."); }
function extractAbsoluteAssetReferences(html:string){ const refs=new Set<string>(); for(const match of html.matchAll(/(?:src|href)="\/([^"#?]+)(?:[?#][^"]*)?"/g)){ if(match[1]) refs.add(match[1]); } return [...refs]; }
function scanForbiddenText(path:string,text:string,patterns:Array<[string,RegExp]>,errors:string[]){ for(const [label,pattern] of patterns) if(pattern.test(text)) errors.push(`${path} contains forbidden ${label}`); }
async function assertNoDeployDestinationCollisions(distDir:string,staticDir:string,snapshotDir:string|null){ const destinations=new Map<string,string>(); const register=(destination:string,origin:string)=>{const previous=destinations.get(destination); if(previous) throw new Error(`deploy source destination collision: ${destination} (${previous} vs ${origin})`); destinations.set(destination,origin);}; for(const path of await listFiles(distDir)) register(path==="public-dashboard.html"?"index.html":path,`dist:${path}`); for(const path of await listFiles(staticDir)) register(path,`static:${path}`); if(snapshotDir) for(const name of SNAPSHOT_NAMES) if(await pathExists(join(snapshotDir,name))) register(`public-data/${name}`,`snapshot:${name}`); register("deploy-manifest.json","generated:deploy-manifest.json"); }
async function validateCopyTreeSource(source:string){ for(const entry of await readdir(source,{withFileTypes:true})){ const sourcePath=join(source,entry.name),info=await lstat(sourcePath); if(info.isSymbolicLink()) throw new Error(`refusing to copy symbolic link: ${sourcePath}`); if(entry.isDirectory()) await validateCopyTreeSource(sourcePath); else if(entry.isFile()){if(info.size>MAX_PUBLIC_FILE_BYTES) throw new Error(`refusing to copy oversized public file: ${sourcePath}`);} else throw new Error(`unsupported public build entry: ${sourcePath}`); } }
async function copyTreeWithoutSymlinks(source:string,destination:string){ for(const entry of await readdir(source,{withFileTypes:true})){ const sourcePath=join(source,entry.name),destinationPath=join(destination,entry.name),info=await lstat(sourcePath); if(info.isSymbolicLink()) throw new Error(`refusing to copy symbolic link: ${sourcePath}`); if(entry.isDirectory()) await copyTreeWithoutSymlinks(sourcePath,destinationPath); else if(entry.isFile()){if(info.size>MAX_PUBLIC_FILE_BYTES) throw new Error(`refusing to copy oversized public file: ${sourcePath}`); await mkdir(dirname(destinationPath),{recursive:true}); await cp(sourcePath,destinationPath,{force:true});} else throw new Error(`unsupported public build entry: ${sourcePath}`); } }
async function listFiles(root:string){ const output:string[]=[]; async function visit(directory:string){ for(const entry of await readdir(directory,{withFileTypes:true})){const absolute=join(directory,entry.name),path=relative(root,absolute).split(sep).join("/"); if(entry.isDirectory()) await visit(absolute); else output.push(path);}} await visit(root); return output.sort(); }
function assertDistinctDirectories(...directories:string[]){ const unique=new Set(directories.map((directory)=>resolve(directory))); if(unique.size!==directories.length) throw new Error("dist, static and output directories must be distinct"); for(const left of unique) for(const right of unique) if(left!==right&&(left.startsWith(`${right}${sep}`)||right.startsWith(`${left}${sep}`))) throw new Error("dist, static and output directories must not contain one another"); }
function assertSnapshotDirectoryIsolation(snapshotDir:string,...directories:string[]){ const snapshot=resolve(snapshotDir); for(const directory of directories.map((value)=>resolve(value))) if(snapshot===directory||snapshot.startsWith(`${directory}${sep}`)||directory.startsWith(`${snapshot}${sep}`)) throw new Error("snapshot directory must be distinct from deploy input/output directories and must not contain one another"); }
async function validateSnapshotInputs(snapshotDir:string){ const present:string[]=[]; for(const name of SNAPSHOT_NAMES){ const source=join(snapshotDir,name); let sourceInfo; try{sourceInfo=await lstat(source);}catch(error){if(isEnoent(error)) continue; throw error;} if(sourceInfo.isSymbolicLink()||!sourceInfo.isFile()) throw new Error(`snapshot input must be a regular file: ${source}`); if(sourceInfo.size>MAX_PUBLIC_FILE_BYTES) throw new Error(`refusing to copy oversized public snapshot: ${source}`); present.push(name);} const researchCount=present.filter((name)=>name==="latest.json"||name==="last-known-good.json").length; if(researchCount===1) throw new Error("latest.json and last-known-good.json must be supplied together"); }
async function validateSnapshotSemantics(snapshotDir:string){
  const nowMs=Date.now();
  const latestPath=join(snapshotDir,"latest.json");
  if(await pathExists(latestPath)){
    const snapshots=new Map<string,{dataAsOf:number;generatedAt:number}>();
    for(const name of ["latest.json","last-known-good.json"] as const){
      let value:unknown;
      try{value=JSON.parse(await readFile(join(snapshotDir,name),"utf8")) as unknown;}catch(error){throw new Error(`${name} is invalid JSON: ${messageOf(error)}`);}
      const verified=await verifyPublicDashboardSnapshotIntegrity(value);
      if(!verified.ok||!verified.snapshot) throw new Error(`${name} failed snapshot integrity verification`);
      const dataAsOf=Date.parse(verified.snapshot.dataAsOf),generatedAt=Date.parse(verified.snapshot.generatedAt);
      if(!Number.isFinite(dataAsOf)) throw new Error(`${name} has an invalid dataAsOf`);
      if(!Number.isFinite(generatedAt)) throw new Error(`${name} has an invalid generatedAt`);
      if(generatedAt-nowMs>DEFAULT_PUBLIC_SNAPSHOT_FUTURE_SKEW_MS) throw new Error(`${name} generatedAt is in the future`);
      if(dataAsOf-nowMs>DEFAULT_PUBLIC_SNAPSHOT_FUTURE_SKEW_MS) throw new Error(`${name} dataAsOf is in the future`);
      if(dataAsOf>generatedAt+DEFAULT_PUBLIC_SNAPSHOT_FUTURE_SKEW_MS) throw new Error(`${name} dataAsOf is after generatedAt`);
      snapshots.set(name,{dataAsOf,generatedAt});
    }
    const latest=snapshots.get("latest.json")!,fallback=snapshots.get("last-known-good.json")!;
    if(latest.dataAsOf<fallback.dataAsOf) throw new Error("latest.json is older than last-known-good.json");
    if(latest.dataAsOf===fallback.dataAsOf&&latest.generatedAt<fallback.generatedAt) throw new Error("latest.json generation is older than last-known-good.json");
  }
  const ownerPath=join(snapshotDir,"owner-latest.json");
  if(await pathExists(ownerPath)){
    let value:unknown;
    try{value=JSON.parse(await readFile(ownerPath,"utf8")) as unknown;}catch(error){throw new Error(`owner-latest.json is invalid JSON: ${messageOf(error)}`);}
    const errors=validateOwnerDashboardSnapshot(value);
    if(errors.length) throw new Error(`owner-latest.json failed owner schema verification: ${errors.join(";")}`);
    const generatedAt=Date.parse((value as {generatedAt:string}).generatedAt);
    if(generatedAt-nowMs>DEFAULT_PUBLIC_SNAPSHOT_FUTURE_SKEW_MS) throw new Error("owner-latest.json generatedAt is in the future");
  }
}
async function canonicalDirectoryTarget(path:string){ const unresolved=[basename(path)]; let parent=dirname(path); while(true){try{return join(await realpath(parent),...unresolved);}catch(error){if(!isEnoent(error)) throw error; const nextParent=dirname(parent); if(nextParent===parent) throw error; unresolved.unshift(basename(parent)); parent=nextParent;}} }
function isEnoent(error:unknown){return typeof error==="object"&&error!==null&&"code" in error&&(error as {code?:unknown}).code==="ENOENT";}
async function requireDirectory(path:string,label:string){const info=await lstat(path); if(info.isSymbolicLink()) throw new Error(`${label} must not be a symbolic link: ${path}`); if(!info.isDirectory()) throw new Error(`${label} is not a directory: ${path}`);}
async function requireFile(path:string,label:string){const info=await stat(path); if(!info.isFile()) throw new Error(`${label} is not a file: ${path}`);}
async function pathExists(path:string){try{await access(path);return true;}catch{return false;}}
function messageOf(error:unknown){return error instanceof Error?error.message:String(error);}
