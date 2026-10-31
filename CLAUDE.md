@AGENTS.md

## Claude Code

- Project settings live in `.claude/settings.json`. Edited Python files are formatted with ruff automatically by a PostToolUse hook, so don't run a separate format pass on them.
- You act with the owner's GitHub credentials, and those credentials can bypass the `main` ruleset. Never force-push, push directly to `main`, delete remote branches, or change rulesets, branch protection or repository settings. `.claude/hooks/guard_git.py` (a PreToolUse hook) blocks these; if it blocks something the owner asked for, tell them and let them run it themselves. Never try to get around the guard.
- Use the git credentials already configured for this checkout. Never print, echo or commit a token.
- Open PRs with `gh pr create --body-file <file>`, following `.github/pull_request_template.md`.
- `./precommit_tests.sh` needs a running Docker daemon and fails before any test runs without one. Read the pytest summary: any skipped test under `tests/integration/` means integration did not run, so report that instead of claiming the full suite passed.
- Keep `AGENTS.md` current when commands, layout or conventions change; put tool-neutral guidance there and Claude-only guidance here.
