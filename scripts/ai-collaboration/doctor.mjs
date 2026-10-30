import { spawnSync } from 'node:child_process';
import { lstatSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function probe(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 15_000, maxBuffer: 64_000, stdio: ['ignore', 'pipe', 'pipe'] });
  // Never print CLI output: an authentication command may include account details.
  return !result.error && result.status === 0;
}

function regularFile(path) {
  try {
    const stat = lstatSync(path);
    return stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && realpathSync(path) === resolve(path);
  } catch { return false; }
}

export function diagnose({ root = process.cwd(), platform = process.platform, run = probe, file = regularFile, env = process.env } = {}) {
  const codexInstalled = run('codex', ['--version']);
  const claudeInstalled = run('claude', ['--version']);
  const checks = {
    macOS: platform === 'darwin',
    databasePresent: file(join(root, 'data/boat.sqlite')),
    codexInstalled, claudeInstalled,
    codexAuthenticated: codexInstalled && run('codex', ['login', 'status']),
    claudeAuthenticated: claudeInstalled && run('claude', ['auth', 'status']),
    apiConfigured: ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'BOAT_CODEX_MODEL', 'BOAT_CLAUDE_MODEL'].every((name) => Boolean(env[name]?.trim())),
  };
  const blockers = [];
  if (!checks.macOS) blockers.push('RUN_ON_MAC_FOR_LOCAL_VALIDATION');
  if (!checks.databasePresent) blockers.push('LOCAL_DATABASE_NOT_FOUND');
  if (!checks.codexInstalled) blockers.push('CODEX_CLI_NOT_INSTALLED');
  else if (!checks.codexAuthenticated) blockers.push('CODEX_LOGIN_REQUIRED');
  if (!checks.claudeInstalled) blockers.push('CLAUDE_CODE_NOT_INSTALLED');
  else if (!checks.claudeAuthenticated) blockers.push('CLAUDE_LOGIN_REQUIRED');
  return { version: 1, state: blockers.length ? 'SETUP_REQUIRED' : 'CLI_PREREQUISITES_PRESENT', checks, blockers,
    codexAppRoute: { claudePrerequisitesPresent: checks.claudeInstalled && checks.claudeAuthenticated,
      codexCliRequired: false, next: 'docs/ai-collaboration/local-app.md' },
    collaborationConnected: false,
    note: 'CLIの存在・ログイン確認だけ。プランの利用枠、隔離実行、AI連携の成功を保証しない。DB・runner設定の変更やAIへの依頼送信は行わない。' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length > 2) throw new Error('NO_ARGUMENTS_SUPPORTED');
  console.log(JSON.stringify(diagnose(), null, 2));
}
