# boat-pon: Codex app and Claude Code

Read `CLAUDE.md` and `docs/current-ai-handoff.md` before making changes. The user's
wallet rules take precedence: no stake/allocation calculations, BUY/SKIP logic,
models/selectors, LINE delivery behavior, app_settings, production database writes,
automatic betting, or saved betting-site logins may be changed.

When the user asks for Codex/Claude collaboration in a **local Mac task**:

1. Codex app is the sole implementation agent; Claude Code reviews through
   `scripts/ai-collaboration/review-local.mjs`. No second Codex CLI or cloud runner
   is required. Read `docs/ai-collaboration/local-app.md` for setup and commands.
2. Preserve existing uncommitted changes. Use an isolated worktree if necessary;
   never auto-stash, reset, or include someone else's changes in a commit.
3. Record the initial full commit SHA and one `AI-...` task ID. Call the local
   review command after implementing the authorized changes. Feed its JSON issues
   back into the implementation without asking the user to copy between chats.
4. Maximum three Claude invocations per task (including failures). Do not create
   new IDs to evade the limit. A blocked review, login error, or limit stops the
   loop and must be reported accurately. Never fall back to paid APIs.
5. This first version reviews only the four miss-review implementation/test files
   listed in `core.mjs`. State that scope explicitly; do not call other changes
   reviewed. An empty diff is not a successful code review.
6. Run the appropriate tests and the product/BUY/LINE boundary checks after fixes.
   A Claude approval is not test success, real-data validation, or merge authority.
7. Commit only task-owned paths and push the task branch when authorized. Never
   push main or auto-merge. Record the base SHA, reviewed digest, test results, and
   the local review verdict in the final report or PR description.

In cloud tasks, do not pretend to access `/Users/...` or a local subscription.
Prepare and test changes here; report Mac-only steps that remain unverified.
