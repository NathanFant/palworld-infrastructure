# 003 — Backup strategy

## Decision

Back up the world save to an OCI Object Storage bucket only, using RCON `Save` + `tar` + upload
(`backups/backup.sh`), with age-based retention tiers (`hourly/`, `daily/`, `weekly/`, `monthly/` prefixes) enforced
by an Object Storage lifecycle policy (`infrastructure/terraform/storage.tf`), authenticated via OCI instance
principal (no static credentials on the game VM).

## Alternatives considered

- **Git branches holding world-save snapshots** — raised early in planning and explicitly rejected/retracted. World
  saves are binary game-state blobs, not text; Git has no meaningful diffing or merging benefit for them, and using
  branches as a backup mechanism would repurpose version control for something Object Storage already does better
  (native lifecycle expiry, no repo bloat, no risk of accidentally treating a save file as source code).
- **Local-disk-only backups on the game VM's Block Volume** — no extra infrastructure, but provides no protection
  against loss of the VM or volume itself, which is exactly the failure mode a backup strategy exists to cover.
- **Keeping every backup forever** — simplest retention policy, but storage cost grows unbounded for no benefit;
  a friend-group server doesn't need indefinite history, just enough recent restore points at multiple time
  horizons.
- **Static OCI API keys on the game VM for upload access** — simpler to set up than instance principals, but
  a long-lived credential on disk is a real credential-leak risk for a box that's also reachable over SSH; instance
  principals give the same capability scoped to "this specific VM, this bucket only" with no secret to leak (see
  `infrastructure/terraform/backup-iam.tf`'s dynamic group + policy).

## Reasoning / tradeoffs

Object Storage alone is simpler to reason about and operate than a hybrid scheme, and its lifecycle-policy engine
does exactly what a retention policy needs (expire by age, per prefix) without custom cleanup scripts. The
tradeoff is that `backup.sh`'s tar+upload is a snapshot-in-time, not continuous replication — acceptable for a
world that's only live while someone's actually playing, and mitigated by running backups at multiple retention
tiers rather than a single interval. `restore.sh` deliberately stages a restored archive rather than auto-overwriting
the live save, so a bad restore choice is always reversible before it touches the running world
(see `docs/disaster-recovery.md`).
