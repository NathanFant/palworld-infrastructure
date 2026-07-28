# CLAUDE.md

Orientation for any agent (or human) working in this repo. Read this before touching infra, the bot, or docs.

## What this is

A Palworld dedicated server for a 3-person friend group, controlled and observed through a Discord bot, built to a production/portfolio standard: infrastructure as code, containerized services, automated backups, and a visible ticket -> PR -> independent-review development pipeline. Game-server compute runs on a Contabo VPS (native x86); Terraform state and world-save backups stay on Oracle Cloud Object Storage (Always Free tier) — see the Architecture section below for why.

Two things are being built at once:
1. The actual hosting stack (Terraform, Docker, the bot).
2. The process used to build it (tickets, PRs, independent review) — treat this as a real convention, not a one-off.

## Architecture

```
                         GitHub (issues/PRs/CI)
                                  |
                     +------------------------+
                     |     Contabo VPS        |  Cloud VPS 6, native x86
                     +------------------------+
                                  |
                                  v
                  Game VM (6 vCPU/12GB, always on, no emulation)
                  - Docker + Palworld dedicated server container
                  - Discord bot container (Node/TS, discord.js v14)
                    - Slash commands, voice-presence watcher
                    - Status heartbeat + 48h lifecycle manager
                    - JSON state file (start time, msg ids)
                  - Bot -> game server: SSH (forced command, loopback) + RCON (loopback)
                  - palworld-ctl wrapper (forced-command SSH)
                  - Plain data directory for world save (no separate block volume)
                                  |
                                  v
                  Oracle Cloud Object Storage bucket (Always Free tier)
                    (world backups + Terraform state -- compute stays on Contabo)
```

One VM, not two — see [`docs/decisions/005-consolidate-bot-onto-game-vm.md`](docs/decisions/005-consolidate-bot-onto-game-vm.md)
for why the Discord bot runs as a second container here rather than on its own host.

**Migrated from Oracle Cloud (ARM64 + box64 emulation) to Contabo (native x86)** — see
[`docs/decisions/006-migrate-to-contabo.md`](docs/decisions/006-migrate-to-contabo.md) for why (box64's emulation
overhead, not the game/save data size, was causing severe memory pressure on Oracle's free-tier ARM shape) and
[`docs/runbooks/contabo-cutover.md`](docs/runbooks/contabo-cutover.md) for how the cutover was done. This is a
deliberate hybrid, not a full Oracle exit: Terraform state and world-save backups stay on Oracle Object Storage
(free tier, zero compute involved). The Oracle game VM (`infrastructure/terraform`'s compute resources) is retired
but not yet destroyed — pending `terraform destroy` against just those resources once Contabo has proven stable for
a while (see that ADR's Status section for current state; keep `infrastructure/terraform`'s IAM/Object-Storage
resources, which must survive).

### Key decisions (and why)

- **One always-on VM, not stop/start of the game VM.** Ampere A1 is Always Free regardless of uptime, so there's no cost benefit to stopping the VM itself — only to stopping the *game process*. Automating OCI instance lifecycle (start/stop) adds fragile API surface for no savings; the bot must stay reachable to run `/server start` even when the game is fully down — which it is, since only the Palworld container is ever started/stopped, never the VM, and the bot's own container runs independently of the Palworld container's state. **Only the Palworld Docker container is started/stopped, never the VM or the bot's container.**
- **SSH with a forced command, not a custom HTTP control-agent.** The bot's SSH key is restricted via `authorized_keys` `command=` on the game VM to only execute `/usr/local/bin/palworld-ctl {start|stop|status}` — no interactive shell. Least-privilege by construction, and there's no bespoke API surface to secure or maintain. This holds even with the bot co-located on the same VM: it still authenticates over SSH as a distinct, single-purpose principal (over loopback now, not a second host) rather than being handed direct Docker/host access.
- **RCON `Shutdown <seconds> <message>` drives the 48h restart countdown**, not a bot-side broadcast loop. Palworld's dedicated server natively announces countdown warnings in-game when shutdown is triggered via RCON with a delay; the bot mirrors the same message into Discord instead of re-implementing countdown timing. Verify exact in-game text/interval behavior against the running server build before relying on it — Palworld's RCON message handling has had version-dependent quirks (e.g. spaces in broadcast text).
- **Palworld image: `thijsvanloef/palworld-server-docker`.** Actively maintained, RCON support, env-driven config, community-server mode. Don't build a custom image unless this one is proven insufficient.
- **JSON state file, not SQLite**, for the bot's persisted state (server start timestamp, status message ID, last known up/down). A handful of low-write-frequency fields don't justify a compiled native dependency. Revisit only if state actually grows past simple key/value facts.
- **Terraform remote state on the Object Storage bucket** (OCI's S3-compatible endpoint), bootstrapped once from local state. Demonstrates real IaC practice without leaving the free tier.
- **CI never runs `terraform apply` and never auto-merges or auto-deploys.** `terraform plan` posts to the PR for review; `apply`, PR merges, and anything touching the real Oracle account or the live Discord bot token are explicit, human-approved actions.

See [`docs/decisions/`](docs/decisions/) for the full reasoning and rejected alternatives behind these and other major choices (Oracle Cloud, Docker, backup strategy, Discord-triggered lifecycle).

## Repository layout

```
.
├── CLAUDE.md                  # this file
├── discord-bot/                # Node/TS bot: slash commands, presence watcher, lifecycle manager
├── docker/                     # compose.yml for the Palworld dedicated server container
├── infrastructure/
│   ├── cloud-init/             # VM bootstrap (Docker install, palworld-ctl, SSH lockdown)
│   └── firewall/                # port/security-list documentation
├── backups/                    # backup.sh / restore.sh + retention policy
├── docs/                       # end-user-facing docs: architecture, deployment, monitoring, runbooks
├── monitoring/
└── scripts/                    # deploy.sh / update.sh operational scripts
```

Terraform itself lives under `infrastructure/` once Phase 1 tickets land (see backlog below).

## The ticket -> PR -> review workflow

This is how every change in this repo gets made:

1. **Ticket.** Open a GitHub issue with Context / Acceptance Criteria / Out of scope, labeled by area (`area:infra`, `area:bot`, `area:backup`, `area:ci`, `area:docs`, `area:process`).
2. **Implementation.** Branch as `feat/<slug>` off `main`, implement against the ticket's acceptance criteria only — no drive-by scope creep.
3. **PR.** Open a PR that closes the issue (`Closes #N`), following `.github/PULL_REQUEST_TEMPLATE.md`.
4. **Independent review.** A reviewer with *no implementation context* — a fresh agent session/subagent, not the one that wrote the code — reviews the actual diff for correctness, security (every RCON/SSH/shell boundary gets scrutinized for injection and least-privilege), and whether acceptance criteria are actually met. This independence is the point: it's a genuine second opinion, not the author checking their own work.
5. **Address feedback**, push updates, get the reviewer's explicit confirmation the fix resolves their findings (don't self-judge that a fix is sufficient).
6. **Merge as soon as review comes back clean** — approved outright, or approved after a confirmed fix. The review is the merge gate; no separate sign-off is needed on top of it.

The one thing that stays human-approved regardless of review status: anything touching real, hard-to-reverse
systems — `terraform apply` (CI only ever runs `plan`), the real Oracle Cloud account, or the live Discord bot
token/production channels. Surface those explicitly and wait for a go-ahead.

See `CONTRIBUTING.md` for the mechanical details (branch naming, PR template, label reference).

## Ticket backlog (execution order)

**Phase 0 — Foundation:** CLAUDE.md (this), repo hygiene/templates, CI skeleton.
**Phase 1 — IaC:** Terraform bootstrap + remote state, VCN/subnets/security lists, game VM + block volume, bot VM, Object Storage bucket, cloud-init, terraform CI.
**Phase 2 — Palworld server:** docker compose service, `palworld-ctl` wrapper, world-save migration runbook.
**Phase 3 — Backups:** backup.sh, restore.sh, disaster-recovery runbook, scheduled backup timer.
**Phase 4 — Bot core:** bot scaffold, RCON + SSH control services, JSON state store, `/server` slash commands.
**Phase 5 — Presence & status:** voice-channel watcher, status heartbeat with live-edited embed.
**Phase 6 — Lifecycle:** 48h restart manager with RCON-driven countdown, timing tests.
**Phase 7 — Bot CI/CD:** lint/test/build pipeline, image publish + deploy to bot VM.
**Phase 8 — Polish:** end-user docs filled in, dedicated security-audit ticket, README rewrite reflecting as-built state.

Track live status via GitHub issues/labels, not this file — this file describes the plan shape, not day-to-day state.

## Secrets and credentials

Never commit: OCI API keys, SSH private keys, the Discord bot token, or `.env` files with real values. `.env.example` documents required variables with placeholder values only. Runtime secrets live in GitHub Actions secrets (for CI) or on the target VM's filesystem (for runtime), never in git history.
