#!/usr/bin/env python3
"""PreToolUse guard for Bash: refuse git/gh commands that rewrite or delete protected history.

Claude Code acts with the owner's GitHub credentials, and those credentials can bypass the
`main` ruleset. This hook blocks force pushes, remote branch deletion, pushes to `main`, and
changes to rulesets, branch protection or repository settings. The owner can still run any of
these by hand.

Exit 2 blocks the tool call and shows stderr to Claude. Anything this script cannot parse is
allowed (exit 0) so a guard bug never blocks ordinary work.
"""

from __future__ import annotations

import json
import re
import shlex
import subprocess
import sys

PROTECTED = "main"
SEPARATORS = {"&&", "||", ";", "|", "&", "|&", "\n"}

# git options that take a separate value before the subcommand
GIT_GLOBAL_WITH_VALUE = {"-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path"}
# git push options that take a separate value
PUSH_WITH_VALUE = {"-o", "--push-option", "--repo", "--receive-pack", "--exec"}
PUSH_BLOCKED_LONG = {
    "force",
    "force-with-lease",
    "force-if-includes",
    "delete",
    "mirror",
    "prune",
    "all",
    "branches",
}
PUSH_BLOCKED_SHORT = {"f", "d"}

GH_REPO_BLOCKED = {"delete", "edit", "rename", "archive", "unarchive"}
SENSITIVE_ENDPOINT = re.compile(r"rulesets|/protection\b|/branches/[^/]+/rename", re.IGNORECASE)
BRANCH_REF_ENDPOINT = re.compile(r"/git/refs/|/branches/", re.IGNORECASE)
REPO_ROOT_ENDPOINT = re.compile(r"^/?repos/[^/]+/[^/]+/?$", re.IGNORECASE)
GRAPHQL_SENSITIVE = re.compile(
    r"ruleset|protection|deleteRef|updateRef|updateRepository|deleteRepository|archiveRepository",
    re.IGNORECASE,
)


def current_branch(cwd: str | None) -> str:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=5,
        )
        return out.stdout.strip()
    except Exception:
        return ""


def segments(command: str) -> list[list[str]]:
    lexer = shlex.shlex(command, posix=True, punctuation_chars=True)
    lexer.whitespace_split = True
    out: list[list[str]] = [[]]
    for tok in lexer:
        if tok in SEPARATORS:
            out.append([])
        else:
            out[-1].append(tok)
    return [seg for seg in out if seg]


def strip_prefix(seg: list[str]) -> list[str]:
    """Drop leading env assignments and common wrappers (env, time, nohup, ...)."""
    wrappers = {"env", "time", "nohup", "nice", "command", "builtin", "exec", "sudo"}
    i = 0
    while i < len(seg) and (re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", seg[i]) or seg[i] in wrappers):
        i += 1
    return seg[i:]


def check_git(args: list[str], cwd: str | None) -> str | None:
    i = 0
    while i < len(args) and args[i].startswith("-"):
        if args[i] == "-C" and i + 1 < len(args):
            cwd = args[i + 1]
        i += 2 if args[i] in GIT_GLOBAL_WITH_VALUE else 1
    if i >= len(args) or args[i] != "push":
        return None
    rest = args[i + 1 :]

    positional: list[str] = []
    j = 0
    while j < len(rest):
        tok = rest[j]
        if tok == "--":
            positional.extend(rest[j + 1 :])
            break
        if tok.startswith("--"):
            name = tok[2:].split("=", 1)[0]
            if name in PUSH_BLOCKED_LONG:
                return f"`git push {tok}`"
            j += 2 if tok in PUSH_WITH_VALUE else 1
            continue
        if tok.startswith("-") and len(tok) > 1:
            if set(tok[1:]) & PUSH_BLOCKED_SHORT:
                return f"`git push {tok}`"
            j += 2 if tok in PUSH_WITH_VALUE else 1
            continue
        positional.append(tok)
        j += 1

    refspecs = positional[1:]  # positional[0] is the remote
    branch = current_branch(cwd)
    for spec in refspecs:
        if spec.startswith("+"):
            return f"force-push refspec `{spec}`"
        if spec.startswith(":"):
            return f"remote branch deletion refspec `{spec}`"
        dst = spec.split(":", 1)[1] if ":" in spec else spec
        if dst in {PROTECTED, f"refs/heads/{PROTECTED}"}:
            return f"a push to `{PROTECTED}`"
        if dst == "HEAD" and branch == PROTECTED:
            return f"a push of HEAD while on `{PROTECTED}`"
    if not refspecs and branch == PROTECTED:
        return f"a push while on `{PROTECTED}`"
    return None


def check_gh(args: list[str]) -> str | None:
    if not args:
        return None
    if args[0] == "repo" and len(args) > 1 and args[1] in GH_REPO_BLOCKED:
        return f"`gh repo {args[1]}`"
    if args[0] == "pr" and len(args) > 1 and args[1] == "merge" and "--admin" in args:
        return "`gh pr merge --admin` (bypasses branch rules)"
    if args[0] != "api":
        return None

    method = None
    endpoint = None
    has_fields = False
    k = 1
    while k < len(args):
        tok = args[k]
        if tok in {"-X", "--method"} and k + 1 < len(args):
            method = args[k + 1].upper()
            k += 2
            continue
        if tok.startswith("--method="):
            method = tok.split("=", 1)[1].upper()
        elif tok.startswith("-X") and len(tok) > 2:
            method = tok[2:].upper()
        elif tok in {"-f", "-F", "--field", "--raw-field", "--input"}:
            has_fields = True
            k += 2
            continue
        elif tok in {"-H", "--header", "-q", "--jq", "-t", "--template", "--hostname", "--cache"}:
            k += 2
            continue
        elif not tok.startswith("-") and endpoint is None:
            endpoint = tok
        k += 1
    method = method or ("POST" if has_fields else "GET")
    endpoint = endpoint or ""

    if endpoint == "graphql":
        body = " ".join(args)
        if "mutation" in body.lower() and GRAPHQL_SENSITIVE.search(body):
            return "a GraphQL mutation on refs, rulesets, protection or repository settings"
        return None
    if method == "GET":
        return None
    if SENSITIVE_ENDPOINT.search(endpoint):
        return f"`gh api -X {method} {endpoint}` (rulesets/branch protection)"
    if method == "DELETE" and BRANCH_REF_ENDPOINT.search(endpoint):
        return f"`gh api -X DELETE {endpoint}` (branch/ref deletion)"
    if method in {"PATCH", "PUT", "DELETE"} and REPO_ROOT_ENDPOINT.search(endpoint):
        return f"`gh api -X {method} {endpoint}` (repository settings)"
    return None


def reason_to_block(command: str, cwd: str | None) -> str | None:
    for seg in segments(command):
        seg = strip_prefix(seg)
        if not seg:
            continue
        exe = seg[0].rsplit("/", 1)[-1]
        if exe == "git":
            reason = check_git(seg[1:], cwd)
        elif exe == "gh":
            reason = check_gh(seg[1:])
        else:
            reason = None
        if reason:
            return reason
    return None


def main() -> int:
    try:
        event = json.load(sys.stdin)
        command = event.get("tool_input", {}).get("command") or ""
        reason = reason_to_block(command, event.get("cwd"))
    except Exception:
        return 0
    if reason:
        print(
            f"Blocked by .claude/hooks/guard_git.py: {reason}. `main` is protected and this "
            "assistant must not rewrite or delete history or change repository settings. "
            "Ask the owner to run it themselves if it is really needed.",
            file=sys.stderr,
        )
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
