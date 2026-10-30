import assert from 'node:assert/strict';
import test from 'node:test';
import { allowedPaths, collaborate, digest, validateChanges, validateRequest, validateReview } from './core.mjs';
import { diagnose } from './doctor.mjs';
import { providers } from './providers.mjs';

const request = { id: 'AI-miss-review-1', baseSha: 'a'.repeat(40), goal: '集計の表示を直す' };
const path = allowedPaths[0];
const originals = { [path]: 'original' };
const changes = { summary: '修正', files: [{ path, content: 'changed' }] };
const approve = async ({ candidateDigest }) => ({ candidateDigest, verdict: 'approve', issues: [] });

test('request identity and exact paths reject injection, traversal, duplicates and empty patches', () => {
  assert.deepEqual(validateRequest(request), request);
  for (const bad of [{ ...request, baseSha: 'main' }, { ...request, id: ['AI-test'] }, { ...request, id: '../../x' }, { ...request, extra: true }]) assert.throws(() => validateRequest(bad));
  for (const denied of ['../src/presentation/missReview.ts', 'src/domain/buy.ts', '.github/workflows/ci.yml', 'data/boat.sqlite', 'src/presentation/../../server/db.ts']) {
    assert.throws(() => validateChanges({ ...changes, files: [{ path: denied, content: 'x' }] }, originals));
  }
  assert.throws(() => validateChanges({ ...changes, files: [changes.files[0], changes.files[0]] }, originals));
  assert.throws(() => validateChanges({ ...changes, files: [{ path, content: 'original' }] }, originals), /NO_CHANGES/);
  assert.throws(() => validateChanges({ ...changes, files: [{ path, content: 'x'.repeat(200001) }] }, originals), /PATCH_TOO_LARGE/);
});

test('review is bound to exact candidate and must be internally consistent', () => {
  const sha = digest(changes);
  assert.throws(() => validateReview({ candidateDigest: 'old', verdict: 'approve', issues: [] }, sha), /STALE/);
  assert.throws(() => validateReview({ candidateDigest: sha, verdict: 'approve', issues: ['不具合'] }, sha));
  assert.throws(() => validateReview({ candidateDigest: sha, verdict: 'revise', issues: [] }, sha));
});

test('writer and reviewer run sequentially and revised content is reviewed again', async () => {
  const events = [];
  let calls = 0;
  const result = await collaborate({ request, originals,
    writer: async ({ previous, feedback }) => {
      calls++;
      if (calls === 2) { assert.deepEqual(previous, changes); assert.deepEqual(feedback, ['説明を修正']); }
      return calls === 1 ? changes : { ...changes, files: [{ path, content: 'revised' }] };
    },
    reviewer: async ({ candidateDigest }) => ({ candidateDigest, verdict: calls === 1 ? 'revise' : 'approve', issues: calls === 1 ? ['説明を修正'] : [] }),
    record: async (event) => { events.push(event); },
  });
  assert.equal(calls, 2);
  assert.equal(result.state, 'REVIEW_PASSED');
  assert.equal(result.realDataValidation, 'PENDING_MAC');
  assert.notEqual(events[1].candidateDigest, result.candidateDigest);
  assert.deepEqual(events.map((event) => event.state), ['WRITING', 'REVIEWING', 'REVISION_REQUIRED', 'WRITING', 'REVIEWING', 'REVIEW_PASSED']);
});

test('review block, provider error, stale review, and revision limit stop immediately', async () => {
  const options = { request, originals, writer: async () => changes, reviewer: approve, record: async () => {} };
  let writes = 0;
  await assert.rejects(collaborate({ ...options, writer: async () => { writes++; return changes; }, reviewer: async ({ candidateDigest }) => ({ candidateDigest, verdict: 'revise', issues: ['修正'] }) }), /REVISION_LIMIT_REACHED/);
  assert.equal(writes, 3);
  await assert.rejects(collaborate({ ...options, reviewer: async ({ candidateDigest }) => ({ candidateDigest, verdict: 'blocked', issues: ['範囲外'] }) }), /REVIEW_BLOCKED/);
  await assert.rejects(collaborate({ ...options, writer: async () => { throw new Error('offline'); } }), /offline/);
  await assert.rejects(collaborate({ ...options, reviewer: async () => ({ candidateDigest: 'stale', verdict: 'approve', issues: [] }) }), /STALE/);
  await assert.rejects(collaborate({ ...options, maxRounds: 4 }), /LIMIT/);
});

test('API setup fails before any network call and provider requests expose no tools', async () => {
  let calls = 0;
  assert.throws(() => providers({}, async () => { calls++; }), /MISSING_CONFIGURATION/);
  assert.equal(calls, 0);
  const env = { OPENAI_API_KEY: 'test-openai', ANTHROPIC_API_KEY: 'test-anthropic', BOAT_CODEX_MODEL: 'writer', BOAT_CLAUDE_MODEL: 'reviewer' };
  const transport = async (url, options) => {
    calls++;
    const body = JSON.parse(options.body);
    assert.equal(body.tools, undefined);
    assert.equal(options.redirect, 'error');
    if (url.includes('openai')) {
      assert.equal(body.store, false);
      return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(changes) }] }] }));
    }
    return new Response(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ candidateDigest: 'hash', verdict: 'approve', issues: [] }) }] }));
  };
  const client = providers(env, transport);
  assert.deepEqual(await client.writer({ rules: 'rules' }), changes);
  assert.equal((await client.reviewer({ rules: 'rules' })).verdict, 'approve');
  assert.equal(calls, 2);
  const failed = providers(env, async () => new Response('sensitive provider response', { status: 401 }));
  await assert.rejects(failed.writer({}), { message: 'PROVIDER_HTTP_401' });
});

test('doctor sends no generation requests and never returns secrets or raw CLI output', () => {
  const commands = [];
  const report = diagnose({ root: '/example', platform: 'darwin', file: () => true, env: { OPENAI_API_KEY: 'do-not-print' },
    run: (command, args) => { commands.push([command, args]); return true; } });
  assert.equal(report.state, 'CLI_PREREQUISITES_PRESENT');
  assert.equal(report.collaborationConnected, false);
  assert.equal(JSON.stringify(report).includes('do-not-print'), false);
  assert.deepEqual(commands, [['codex', ['--version']], ['claude', ['--version']], ['codex', ['login', 'status']], ['claude', ['auth', 'status']]]);
  const absent = diagnose({ platform: 'linux', file: () => false, run: () => false, env: {} });
  assert.equal(absent.state, 'SETUP_REQUIRED');
  assert.ok(absent.blockers.includes('LOCAL_DATABASE_NOT_FOUND'));
});
