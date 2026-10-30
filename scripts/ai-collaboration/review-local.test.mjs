import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { allowedPaths } from './core.mjs';
import { createSubscriptionReviewer, localReview, reviewSnapshot, subscriptionEnvironment } from './review-local.mjs';

const flags = '--tools --strict-mcp-config --mcp-config --setting-sources --settings --no-session-persistence --output-format --json-schema --max-turns --system-prompt';

test('subscription reviewer disables tools, MCP, hooks, API env and sends only supplied input over stdin', async () => {
  const calls = [];
  const env = { HOME: '/example', PATH: '/usr/bin', ANTHROPIC_API_KEY: 'secret', ANTHROPIC_BASE_URL: 'https://untrusted.invalid', CLAUDE_CODE_OAUTH_TOKEN: 'secret', GITHUB_TOKEN: 'secret' };
  assert.deepEqual(subscriptionEnvironment(env), { HOME: '/example', PATH: '/usr/bin' });
  const client = createSubscriptionReviewer({ env, invoke: (command, args, options) => {
    calls.push({ command, args, options });
    if (args[0] === '--help') return flags;
    if (args[0] === 'auth') return JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', email: 'not-retained@example.invalid' });
    assert.equal(options.cwd, calls[0].options.cwd);
    assert.deepEqual(options.env, { HOME: '/example', PATH: '/usr/bin' });
    assert.equal(args[args.indexOf('--tools') + 1], '');
    assert.equal(args[args.indexOf('--setting-sources') + 1], '');
    assert.equal(args[args.indexOf('--settings') + 1], '{"disableAllHooks":true}');
    assert.equal(args[args.indexOf('--mcp-config') + 1], '{"mcpServers":{}}');
    assert.equal(args[args.indexOf('--max-turns') + 1], '1');
    assert.equal(args.includes('--dangerously-skip-permissions'), false);
    const input = JSON.parse(options.input);
    assert.deepEqual(input, { candidateDigest: 'hash', patch: 'supplied-diff-only' });
    return JSON.stringify({ subtype: 'success', structured_output: { candidateDigest: 'hash', verdict: 'approve', issues: [] } });
  } });
  try {
    assert.equal((await client.review({ candidateDigest: 'hash', patch: 'supplied-diff-only' })).verdict, 'approve');
    assert.equal(calls.length, 3);
  } finally { client.close(); }
});

test('unsupported CLI or API-key login is rejected before a generation call', () => {
  let generations = 0;
  assert.throws(() => createSubscriptionReviewer({ invoke: () => 'old help' }), /UPDATE_REQUIRED/);
  assert.throws(() => createSubscriptionReviewer({ invoke: (command, args) => {
    if (args[0] === '--help') return flags;
    if (args[0] === 'auth') return JSON.stringify({ loggedIn: true, authMethod: 'api_key' });
    generations++;
  } }), /NO_API_FALLBACK/);
  assert.equal(generations, 0);
});

async function fixture(action) {
  const root = mkdtempSync(join(tmpdir(), 'boat-local-review-'));
  const git = (args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    git(['init']);
    writeFileSync(join(root, '.gitignore'), 'data/tmp/\n');
    for (const path of allowedPaths) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), '// baseline\n'); }
    mkdirSync(join(root, 'data'), { recursive: true });
    writeFileSync(join(root, 'data/boat.sqlite'), 'PRIVATE_DB_MUST_NOT_BE_READ_OR_SENT');
    git(['add', '.gitignore', ...allowedPaths]);
    git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture']);
    await action({ root, git });
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test('local review covers staged and unstaged code only, retains feedback, and stops after three calls', async () => {
  await fixture(async ({ root, git }) => {
    writeFileSync(join(root, allowedPaths[0]), '// staged change\n');
    git(['add', allowedPaths[0]]);
    writeFileSync(join(root, allowedPaths[1]), '// unstaged change\n');
    const before = git(['status', '--porcelain']);
    let calls = 0;
    const makeReviewer = () => ({ close() {}, review: async (input) => {
      calls++;
      assert.match(input.patch, /staged change/);
      assert.match(input.patch, /unstaged change/);
      assert.doesNotMatch(JSON.stringify(input), /PRIVATE_DB_MUST_NOT_BE_READ_OR_SENT/);
      return { candidateDigest: input.candidateDigest, verdict: 'revise', issues: ['境界を確認する'] };
    } });
    for (let round = 1; round <= 3; round++) {
      const result = await localReview({ root, taskId: 'AI-test', makeReviewer });
      assert.equal(result.round, round);
      assert.equal(result.review.verdict, 'revise');
      assert.deepEqual(JSON.parse(readFileSync(join(result.output, 'review.json'), 'utf8')), result);
    }
    await assert.rejects(localReview({ root, taskId: 'AI-test', makeReviewer }), /LIMIT_REACHED/);
    assert.equal(calls, 3);
    assert.equal(git(['status', '--porcelain']), before);
    assert.equal(readFileSync(join(root, 'data/boat.sqlite'), 'utf8'), 'PRIVATE_DB_MUST_NOT_BE_READ_OR_SENT');
  });
});

test('connection test is distinguished from code review and concurrent code edits invalidate approval', async () => {
  await fixture(async ({ root }) => {
    assert.throws(() => reviewSnapshot(root), /NO_ALLOWED_CHANGES/);
    const result = await localReview({ root, taskId: 'AI-smoke', smoke: true, makeReviewer: () => ({ close() {}, review: async (input) => {
      assert.equal(input.kind, 'connection-test-only');
      assert.equal(input.patch, '');
      return { candidateDigest: input.candidateDigest, verdict: 'approve', issues: [] };
    } }) });
    assert.equal(result.state, 'CONNECTION_CONFIRMED');
    assert.equal(result.realDataValidation, 'NOT_RUN');
    writeFileSync(join(root, allowedPaths[0]), '// first\n');
    await assert.rejects(localReview({ root, taskId: 'AI-race', makeReviewer: () => ({ close() {}, review: async (input) => {
      writeFileSync(join(root, allowedPaths[0]), '// second\n');
      return { candidateDigest: input.candidateDigest, verdict: 'approve', issues: [] };
    } }) }), /WORKTREE_CHANGED/);
  });
});
