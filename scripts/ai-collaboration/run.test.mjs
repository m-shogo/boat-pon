import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { allowedPaths } from './core.mjs';
import { run } from './run.mjs';

async function fixture(action) {
  const root = mkdtempSync(join(tmpdir(), 'boat-ai-collaboration-'));
  const git = (args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    git(['init']);
    writeFileSync(join(root, '.gitignore'), 'data/tmp/\n');
    for (const path of allowedPaths) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), `// baseline ${path}\n`);
    }
    git(['add', '.gitignore', ...allowedPaths]);
    git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture']);
    const baseSha = git(['rev-parse', 'HEAD']).trim();
    await action({ root, git, request: { id: 'AI-test', baseSha, goal: 'レポートを改善する' } });
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test('dry-run reads committed code only and makes no worktree changes or provider calls', async () => {
  await fixture(async ({ root, git, request }) => {
    const before = readFileSync(join(root, allowedPaths[0]), 'utf8');
    const report = await run({ root, request, env: {} });
    assert.equal(report.state, 'DRY_RUN_OK');
    assert.equal(report.providerCalls, 0);
    assert.equal(report.realDataValidation, 'PENDING_MAC');
    assert.equal(readFileSync(join(root, allowedPaths[0]), 'utf8'), before);
    assert.equal(git(['status', '--porcelain']), '');
    await assert.rejects(run({ root, request, env: {}, execute: true }), /MISSING_CONFIGURATION/);
    assert.equal(git(['status', '--porcelain']), '');
  });
});

test('stale revision and dirty worktree are rejected before generation', async () => {
  await fixture(async ({ root, request }) => {
    await assert.rejects(run({ root, request: { ...request, baseSha: 'b'.repeat(40) } }), /BASE_SHA_MISMATCH/);
    writeFileSync(join(root, allowedPaths[0]), 'user changes');
    await assert.rejects(run({ root, request }), /DIRTY_WORKING_TREE/);
    assert.equal(readFileSync(join(root, allowedPaths[0]), 'utf8'), 'user changes');
  });
});

test('execution stores reviewed proposals without applying code and duplicate IDs never call models again', async () => {
  await fixture(async ({ root, git, request }) => {
    let calls = 0;
    const createProviders = () => ({
      writer: async () => { calls++; return { summary: 'change', files: [{ path: allowedPaths[0], content: 'candidate only' }] }; },
      reviewer: async ({ candidateDigest }) => { calls++; return { candidateDigest, verdict: 'approve', issues: [] }; },
    });
    const result = await run({ root, request, execute: true, createProviders });
    assert.equal(calls, 2);
    assert.equal(result.changesApplied, false);
    const candidate = JSON.parse(readFileSync(join(result.output, 'candidate.json'), 'utf8'));
    assert.equal(candidate.candidateDigest, result.candidateDigest);
    assert.equal(candidate.realDataValidation, 'PENDING_MAC');
    assert.match(readFileSync(join(root, allowedPaths[0]), 'utf8'), /baseline/);
    assert.equal(git(['status', '--porcelain']), '');
    await assert.rejects(run({ root, request, execute: true, createProviders }), /EEXIST/);
    assert.equal(calls, 2);
  });
});

test('provider failure preserves evidence, redacts raw exception, and cannot retry the same request', async () => {
  await fixture(async ({ root, request }) => {
    const createProviders = () => ({ writer: async () => { throw new Error('sensitive-value'); }, reviewer: async () => { throw new Error('unreachable'); } });
    await assert.rejects(run({ root, request, execute: true, createProviders }), /RUN_FAILED_SEE_LOCAL_EVENTS/);
    const events = readFileSync(join(root, 'data/tmp/ai-collaboration', request.id, 'events.jsonl'), 'utf8');
    assert.match(events, /FAILED/);
    assert.doesNotMatch(events, /sensitive-value/);
    await assert.rejects(run({ root, request, execute: true, createProviders }), /EEXIST/);
  });
});
