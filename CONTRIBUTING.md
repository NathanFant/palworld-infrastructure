# Contributing

This repo (including work done by agents) follows a ticket -> PR -> independent-review pipeline. See `CLAUDE.md`
for the architecture and rationale; this file covers the mechanics. See
[`docs/claude-workflow.md`](docs/claude-workflow.md) for the working habits an agent should follow day to day on
top of this mechanic (verification standards, comment style, how review is actually conducted).

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

**Merge as soon as the independent review comes back clean** — approved outright, or approved after requested
changes were made and the reviewer confirmed the fix. No separate merge sign-off is needed on top of that; the
review *is* the gate. If a review requests changes, address them, get the reviewer's explicit confirmation that
the fix resolves their findings, then merge — don't merge on your own judgment that a fix "should" be sufficient.

This does **not** extend to actions that touch real, hard-to-reverse systems — those stay explicit and
human-approved regardless of review status:
- Any `terraform apply` (CI only ever runs `plan`)
- Any action touching the real Oracle Cloud account
- Any action touching the live Discord bot token or production channels

Surface those explicitly and wait for a go-ahead rather than assuming approval carries over from a merge.

## Branch protection

Not yet configured — enabling required-status-checks and required-reviews on `main` needs repo-admin action taken
manually in GitHub's settings UI. Until then, this document is the enforced convention.
