import { spawnSync, execFileSync } from 'node:child_process';
import { lstatSync, mkdirSync, mkdtempSync, realpathSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { allowedPaths, digest, rules, validateReview } from './core.mjs';

const requiredFlags = ['--tools', '--strict-mcp-config', '--mcp-config', '--setting-sources', '--settings', '--no-session-persistence', '--output-format', '--json-schema', '--max-turns', '--system-prompt'];

export function subscriptionEnvironment(env) {
  // Inherit login locations and ordinary OS settings, never API keys, endpoints,
  // cloud-provider selectors, GitHub/LINE credentials, or parent Claude sessions.
  return Object.fromEntries(['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'LANG', 'LC_ALL', 'TERM', 'CLAUDE_CONFIG_DIR']
    .filter((key) => typeof env[key] === 'string').map((key) => [key, env[key]]));
}

function command(command, args, options) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 180_000, maxBuffer: 1_000_000,
    stdio: ['pipe', 'pipe', 'pipe'], ...options });
  if (result.error?.code === 'ENOENT') throw new Error('CLAUDE_CODE_NOT_INSTALLED');
  if (result.error || result.status !== 0) throw new Error('CLAUDE_COMMAND_FAILED_CHECK_LOCAL_LOGIN_OR_USAGE_LIMIT');
  return result.stdout;
}

export function createSubscriptionReviewer({ env = process.env, invoke = command } = {}) {
  const cleanEnv = subscriptionEnvironment(env);
  const isolated = realpathSync(mkdtempSync(join(tmpdir(), 'boat-claude-review-')));
  try {
    const options = { cwd: isolated, env: cleanEnv };
    const help = invoke('claude', ['--help'], options);
    if (requiredFlags.some((flag) => !help.includes(flag))) throw new Error('CLAUDE_CODE_UPDATE_REQUIRED');
    let auth;
    try { auth = JSON.parse(invoke('claude', ['auth', 'status'], options)); }
    catch { throw new Error('CLAUDE_SUBSCRIPTION_LOGIN_CHECK_FAILED'); }
    if (auth.loggedIn !== true || auth.authMethod !== 'claude.ai') throw new Error('CLAUDE_SUBSCRIPTION_LOGIN_REQUIRED_NO_API_FALLBACK');
    return {
      review: async (input) => {
        const schema = { type: 'object', additionalProperties: false, required: ['candidateDigest', 'verdict', 'issues'], properties: {
          candidateDigest: { type: 'string', const: input.candidateDigest },
          verdict: { type: 'string', enum: ['approve', 'revise', 'blocked'] },
          issues: { type: 'array', maxItems: 30, items: { type: 'string', maxLength: 4000 } },
        } };
        const args = ['-p', '--tools', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
          '--setting-sources', '', '--settings', '{"disableAllHooks":true}', '--no-session-persistence',
          '--output-format', 'json', '--json-schema', JSON.stringify(schema), '--max-turns', '1',
          '--system-prompt', `${rules}\nあなたはCodexアプリの変更をレビューする。修正・コマンド実行は行わず、正確性、回帰、テスト、財布ルールを確認する。JSONでcandidateDigest、verdict(approve/revise/blocked)、issuesを返す。approveはissues空、他は具体的な指摘が必須。接続テストの入力なら仕様レビューと混同せず、接続確認として返す。`];
        let response;
        try { response = JSON.parse(invoke('claude', args, { ...options, input: JSON.stringify(input) })); }
        catch { throw new Error('CLAUDE_REVIEW_FAILED_NO_AUTOMATIC_RETRY'); }
        if (response.is_error || (response.subtype && response.subtype !== 'success')) throw new Error('CLAUDE_REVIEW_INCOMPLETE');
        let review = response.structured_output;
        if (!review) {
          try { review = JSON.parse(response.result); } catch { throw new Error('CLAUDE_REVIEW_INVALID_JSON'); }
        }
        return validateReview(review, input.candidateDigest);
      },
      close: () => rmSync(isolated, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(isolated, { recursive: true, force: true });
    throw error;
  }
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', timeout: 30_000,
    maxBuffer: 300_000, stdio: ['ignore', 'pipe', 'pipe'] });
}

export function reviewSnapshot(root, base = 'HEAD', smoke = false) {
  if (base !== 'HEAD' && !/^[a-f0-9]{40}$/.test(base)) throw new Error('BASE_MUST_BE_HEAD_OR_FULL_SHA');
  const baseSha = git(root, ['rev-parse', '--verify', `${base}^{commit}`]).trim();
  const headSha = git(root, ['rev-parse', 'HEAD']).trim();
  const patch = smoke ? '' : git(root, ['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--unified=30', baseSha, '--', ...allowedPaths]);
  if (!smoke && !patch.trim()) throw new Error('NO_ALLOWED_CHANGES_TO_REVIEW');
  if (Buffer.byteLength(patch) > 200_000 || patch.includes('Binary files ')) throw new Error('REVIEW_DIFF_TOO_LARGE_OR_BINARY');
  const input = { kind: smoke ? 'connection-test-only' : 'code-review', baseSha, headSha, scope: allowedPaths, patch };
  return { ...input, candidateDigest: digest(input) };
}

function claim(root, taskId) {
  if (typeof taskId !== 'string' || !/^AI-[a-zA-Z0-9-]{1,60}$/.test(taskId)) throw new Error('INVALID_TASK_ID');
  let directory = realpathSync(root);
  for (const part of ['data', 'tmp', 'ai-local-review', taskId]) {
    directory = join(directory, part);
    try { mkdirSync(directory, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink() || realpathSync(directory) !== directory) throw new Error('UNSAFE_REVIEW_DIRECTORY');
  }
  const lock = join(directory, 'running');
  try { mkdirSync(lock, { mode: 0o700 }); } catch { throw new Error('TASK_RUNNING_OR_INTERRUPTED_CHECK_LOCAL_RECORDS'); }
  for (let round = 1; round <= 3; round++) {
    const output = join(directory, `round-${round}`);
    try { mkdirSync(output, { mode: 0o700 }); return { output, round, release: () => rmdirSync(lock) }; }
    catch (error) { if (error.code !== 'EEXIST') { rmdirSync(lock); throw error; } }
  }
  rmdirSync(lock);
  throw new Error('LOCAL_REVIEW_LIMIT_REACHED');
}

export async function localReview({ root = process.cwd(), taskId, base = 'HEAD', smoke = false,
  makeReviewer = createSubscriptionReviewer } = {}) {
  root = realpathSync(root);
  const input = reviewSnapshot(root, base, smoke);
  const slot = claim(root, taskId);
  let client;
  try {
    client = makeReviewer();
    const review = validateReview(await client.review(input), input.candidateDigest);
    if (reviewSnapshot(root, input.baseSha, smoke).candidateDigest !== input.candidateDigest) throw new Error('WORKTREE_CHANGED_DURING_REVIEW');
    const result = { version: 1, taskId, round: slot.round, state: smoke ? 'CONNECTION_CONFIRMED' : 'REVIEW_COMPLETE',
      candidateDigest: input.candidateDigest, baseSha: input.baseSha, headSha: input.headSha, scope: allowedPaths,
      review, realDataValidation: 'NOT_RUN', output: slot.output };
    writeFileSync(join(slot.output, 'review.json'), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    return result;
  } catch (error) {
    const known = ['CLAUDE_CODE_NOT_INSTALLED', 'CLAUDE_CODE_UPDATE_REQUIRED', 'CLAUDE_SUBSCRIPTION_LOGIN_CHECK_FAILED',
      'CLAUDE_SUBSCRIPTION_LOGIN_REQUIRED_NO_API_FALLBACK', 'CLAUDE_COMMAND_FAILED_CHECK_LOCAL_LOGIN_OR_USAGE_LIMIT',
      'CLAUDE_REVIEW_FAILED_NO_AUTOMATIC_RETRY', 'CLAUDE_REVIEW_INCOMPLETE', 'CLAUDE_REVIEW_INVALID_JSON',
      'INVALID_OR_STALE_REVIEW', 'WORKTREE_CHANGED_DURING_REVIEW'];
    const reason = known.includes(error.message) ? error.message : 'CHECK_LOCAL_REVIEW_STATE';
    writeFileSync(join(slot.output, 'failed.json'), JSON.stringify({ state: 'FAILED', candidateDigest: input.candidateDigest,
      reason, noAutomaticRetry: true }), { flag: 'wx', mode: 0o600 });
    throw new Error(`${reason}:SEE_LOCAL_RECORD:${slot.output}`);
  } finally { client?.close(); slot.release(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  let taskId, base = 'HEAD', smoke = false, hasBase = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--task' && !taskId && args[index + 1]) taskId = args[++index];
    else if (args[index] === '--base' && !hasBase && args[index + 1]) { base = args[++index]; hasBase = true; }
    else if (args[index] === '--smoke' && !smoke) smoke = true;
    else throw new Error('USAGE: --task AI-id [--base HEAD-or-40hex] [--smoke]');
  }
  console.log(JSON.stringify(await localReview({ taskId, base, smoke }), null, 2));
}
