# Working in this repo as Claude (or any agent)

This documents the practices already visible in this repo's history — not a new process, a description of the one
already in use. For the formal ticket -> PR -> review mechanics, see `CONTRIBUTING.md` and `CLAUDE.md`; this file
covers the working habits around that mechanic.

## Starting from context, not from scratch

Before touching infra, the bot, or docs, read `CLAUDE.md` (architecture + key decisions), `docs/decisions/` (the
reasoning behind those decisions), and whichever `docs/runbooks/*.md` is relevant to the task. These are treated as
living, current documentation — if something in them turns out to be stale or wrong while working, fix it in the
same PR rather than leaving the discrepancy for later.

## Approaching a change

- Every change traces back to a GitHub issue with Context / Acceptance Criteria / Out of scope, labeled by area.
  Implementation targets exactly those acceptance criteria — adjacent improvements noticed along the way become a
  new ticket, not scope creep on the current one.
- Branch as `feat/<slug>` (or `fix/<slug>`) off `main`.
- For anything with more than a couple of steps, track progress with a running todo list so partially-done work is
  never silently dropped mid-task.

## Verification is commands, not claims

Before opening a PR, actually run the project's validation commands and look at their real output — lint,
typecheck, test suite, build, and `npm audit` for the bot; `terraform fmt`/`validate`/`plan` for infra;
`shellcheck` for scripts. A change isn't "done" until these have actually been executed in this session, not
assumed to pass. The same standard applies to fixes: after making a change intended to fix something, verify it
(rerun the failing test, reproduce the original repro case) rather than trusting the diff on sight.

## Catching problems before they're shipped

Several real bugs in this repo's history were caught by re-reading a diff before pushing, not by review: RCON not
published in `docker/compose.yml` (would have made the bot unable to reach it at all, being on a separate VM),
`deploy.sh` chowning files to the wrong user (would have broken backup.sh's ability to read them), and a batch of
infra changes accidentally committed directly to `main` instead of a feature branch (recovered via a captured
branch + reset, disclosed transparently rather than silently corrected). The habit worth continuing: read your own
diff like a skeptical reviewer before it leaves your hands, especially at RCON/SSH/shell boundaries.

## Recurring patterns, once learned, get applied proactively

This repo has hit the same class of bug three times independently: unserialized async operations racing against
shared process-local state (`stateStore.ts`'s `updateState`, `presenceWatcher.ts`'s `renderPresence`,
`statusHeartbeat.ts`'s `runHeartbeatCheck` — each fixed with the same promise-chain write-queue pattern, the first
two caught by independent review, the third also only fully caught by review despite the pattern already being
known). The lesson: once a pattern is established in this codebase, apply it from the start on the next similar
module, rather than waiting for review to catch the same bug class again. `lifecycleManager.ts` applied the
write-queue pattern from its first draft for exactly this reason.

## Comments and code style

Default to no comments. When one is warranted, it explains *why* (a non-obvious constraint, a workaround for a
specific quirk, a decision that would otherwise look arbitrary or wrong) — never *what* the code does, since
identifiers and structure already say that. No docstrings, no restating the ticket or the diff in a comment.

## Independent review is real, not theater

Every PR gets reviewed by a fresh agent session with no implementation context — it fetches the actual PR diff
(`gh pr diff`) and the linked issue (`gh issue view`), not just the PR description, and checks correctness,
whether acceptance criteria are actually met, and (for this repo specifically) scrutinizes every RCON/SSH/shell
boundary for injection risk and least-privilege. Because this repo's GitHub setup can't self-approve a PR (author
and reviewer share one account), the reviewer posts a plain comment stating its verdict rather than using GitHub's
approve action — worded as a genuine verdict, not framed as a workaround for the approval limitation. Once that
review comes back clean (either immediately, or after a requested fix that the reviewer explicitly confirms
resolves their finding), the PR is merged — no separate human sign-off is layered on top of a clean review.

## What always stays a human, explicit action

Regardless of how clean a review comes back: `terraform apply` (CI only ever runs `plan`), anything touching the
real Oracle Cloud account, and anything touching the live Discord bot token or production channels. These are
surfaced explicitly and executed only with an actual go-ahead — never bundled into a "review passed, merging" flow.
Where a tool or sandbox is itself blocked from running one of these (e.g. `terraform apply`), that's disclosed
plainly rather than routed around.

## Handling real secrets and credentials

Real values (OCI keys, SSH keys, Discord tokens, `.tfvars`/`backend.hcl`/`.env.local` contents) are read only when
needed to fill in a config file, never echoed in full in commit messages, PR text, or chat output after the point
they're first needed. `.env.example`/`.tfvars.example` document variable names with placeholders only.
