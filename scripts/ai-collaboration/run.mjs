import { execFileSync } from 'node:child_process';
import { appendFileSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { allowedPaths, collaborate, digest, validateRequest } from './core.mjs';
import { providers } from './providers.mjs';

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', timeout: 30_000, maxBuffer: 1_000_000, stdio: ['ignore', 'pipe', 'pipe'] });
}

function outputDirectory(root, id) {
  // All output stays under ignored data/tmp; ancestors must be real directories.
  let directory = realpathSync(root);
  for (const name of ['data', 'tmp', 'ai-collaboration']) {
    directory = join(directory, name);
    try { mkdirSync(directory, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink() || realpathSync(directory) !== directory) throw new Error('UNSAFE_OUTPUT_DIRECTORY');
  }
  directory = join(directory, id);
  // mkdir is the claim: duplicate requests and crash retries never overwrite evidence.
  mkdirSync(directory, { mode: 0o700 });
  return directory;
}

export async function run({ root = process.cwd(), request, execute = false, env = process.env, createProviders = providers }) {
  request = validateRequest(request);
  root = realpathSync(root);
  const head = git(root, ['rev-parse', 'HEAD']).trim();
  if (head !== request.baseSha) throw new Error('BASE_SHA_MISMATCH');
  if (git(root, ['status', '--porcelain']).trim()) throw new Error('DIRTY_WORKING_TREE');
  const originals = {};
  for (const path of allowedPaths) {
    const mode = git(root, ['ls-tree', request.baseSha, '--', path]);
    if (!/^100644 blob /.test(mode)) throw new Error('SOURCE_NOT_REGULAR_TRACKED_FILE');
    originals[path] = git(root, ['show', `${request.baseSha}:${path}`]);
  }
  if (Buffer.byteLength(JSON.stringify(originals)) > 200_000) throw new Error('SOURCE_TOO_LARGE');
  // Dry-run never claims a request, loads API credentials, or calls either provider.
  if (!execute) return { state: 'DRY_RUN_OK', request, sourceDigest: digest(originals), allowedPaths,
    providerCalls: 0, realDataValidation: 'PENDING_MAC', changesApplied: false };
  const client = createProviders(env); // Fail before creating a run when configuration is absent.
  const directory = outputDirectory(root, request.id);
  const record = async (event) => appendFileSync(join(directory, 'events.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`, { mode: 0o600 });
  writeFileSync(join(directory, 'request.json'), `${JSON.stringify(request, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  try {
    const result = await collaborate({ request, originals, ...client, record });
    if (git(root, ['rev-parse', 'HEAD']).trim() !== head || git(root, ['status', '--porcelain']).trim()) throw new Error('REPOSITORY_CHANGED_DURING_REVIEW');
    writeFileSync(join(directory, 'candidate.json'), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    return { state: result.state, candidateDigest: result.candidateDigest, rounds: result.rounds,
      output: directory, changesApplied: false, realDataValidation: 'PENDING_MAC' };
  } catch {
    // Provider response bodies, keys and raw exception text are never retained.
    await record({ state: 'FAILED', reason: 'RUN_FAILED_NO_AUTOMATIC_RETRY' });
    throw new Error('RUN_FAILED_SEE_LOCAL_EVENTS');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length < 1 || args.length > 2 || (args[1] && args[1] !== '--execute')) {
    throw new Error('USAGE: node scripts/ai-collaboration/run.mjs request.json [--execute]');
  }
  const result = await run({ request: JSON.parse(readFileSync(args[0], 'utf8')), execute: args[1] === '--execute' });
  console.log(JSON.stringify(result, null, 2));
}
