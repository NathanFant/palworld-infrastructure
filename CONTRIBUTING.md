# Contributing

This repo (including work done by agents) follows a ticket -> PR -> independent-review pipeline. See `CLAUDE.md`
for the architecture and rationale; this file covers the mechanics.

## 1. Open a ticket

Every change starts as a GitHub issue using the **Ticket** template, with:
- **Context** — why this is needed
- **Acceptance Criteria** — a checklist defining "done"
- **Out of scope** — what this ticket deliberately excludes (often a pointer to a later ticket)

Label it by area: `area:infra`, `area:bot`, `area:backup`, `area:ci`, `area:docs`, or `area:process`.

## 2. Branch and implement

- Branch off `main` as `feat/<short-slug>` (or `fix/<short-slug>` for bug fixes).
- Implement against the ticket's acceptance criteria only. If you discover adjacent work worth doing, open a new
  ticket for it rather than expanding scope in-flight.

## 3. Open a PR

- Use the PR template (auto-populated). Fill in **Summary** and **Test plan**; leave the reviewer checklist for the
  reviewer.
- Reference the ticket with `Closes #N`.
- Push CI to green before requesting review.

## 4. Independent review

Every PR gets reviewed by someone (or some agent) who did **not** write the implementation and has no prior
context on it — a genuine second opinion, not the author checking their own work. The reviewer:
- Reads the actual diff (not just the PR description)
- Checks correctness against the linked ticket's acceptance criteria
- Scrutinizes every RCON/SSH/shell command boundary for injection risk and least-privilege
- Confirms no secrets/credentials were committed
- Leaves a real review (approve, or request changes with specifics)

Label the PR `needs-review` while this is pending.

## 5. Address feedback

Push follow-up commits addressing review comments. Re-request review if the changes are substantive; a reviewer
acknowledgment is enough for small follow-ups (typos, wording).

## 6. Merge

**Merging is always a human-approved step** — don't merge your own PR on your own initiative, even after a passing
review. The same applies to:
- Any `terraform apply` (CI only ever runs `plan`)
- Any action touching the real Oracle Cloud account
- Any action touching the live Discord bot token or production channels

Surface these explicitly and wait for a go-ahead rather than assuming approval carries over from a prior action.

## Branch protection

Not yet configured — enabling required-status-checks and required-reviews on `main` needs repo-admin action taken
manually in GitHub's settings UI. Until then, this document is the enforced convention.
