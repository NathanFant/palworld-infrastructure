# 006 — Migrate the game server from Oracle (ARM64/box64) to Contabo (native x86)

## Decision

Move compute for the Palworld dedicated server off Oracle's Ampere A1 (ARM64) VM onto a Contabo Cloud VPS 6 (native
x86-64, 6 vCPU / 12GB RAM / 200GB SSD, US-Central region), landing at roughly **$9.10/month** — well under this
project's $20/month ceiling, with real measured headroom over actual usage rather than a guess.

This is a deliberate **hybrid**, not a full exit from Oracle: Terraform remote state and world-save backups stay on
Oracle Object Storage (free tier, zero compute involved, no realistic ongoing-charge risk). Only game-server
*compute* — the thing that was actually costly and broken — moves.

## Context that forced this decision

The Oracle game VM repeatedly hit severe memory/swap thrashing (30GB+ RSS on a 32GB instance, ~14GB swap) within
minutes of every restart, with **zero players connected**. Three targeted mitigations were tried and each measured,
over a real post-restart observation window, to have **no effect**:

- Disabling invader-enemy raids (#89/PR #90)
- Capping dropped-item and building counts (#91/PR #92)
- Two rounds of box64 DynaRec tuning — enabling block purging (#93/PR #94), then more aggressive purge-age/bigblock
  settings (#95/PR #96)

The real cause was confirmed by direct comparison, not more guessing: the identical save runs fine natively on a
32GB Windows PC (measured live: **~8–9.5GB RAM, 4–6 CPU cores** actually used, with up to 3 players connected), but
blows up on the Oracle ARM64 VM. The only variable that differs between the two environments is **box64** — the
x86-to-ARM64 JIT emulation layer required because Oracle's free-tier compute is ARM64 (Ampere A1) but Palworld's
Linux dedicated-server binary is x86-only.

Oracle has no affordable native-x86 alternative at this project's real, measured sizing: the free x86 tier
(`E2.1.Micro`) is far too small, and Oracle's paid x86 shapes would cost roughly **$90/month** — defeating the
entire point of staying on Oracle. Oracle's A1 (ARM) shape being the only cheap option is exactly why emulation was
forced in the first place (see [`001-why-oracle.md`](001-why-oracle.md)).

## Alternatives considered

- **Keep tuning box64 on Oracle** — rejected as exhausted, not just unattractive: DynaRec purging, purge-age, block
  size, and per-block metadata tracking were all tuned and measured with no improvement over consistent 15–21 minute
  observation windows. This isn't a config problem; it's the fundamental cost of emulating x86 on ARM64 for a
  workload this memory-hungry.
- **Pay for an Oracle native-x86 shape** — rejected: ~$90/month, more than 4x this project's budget ceiling.
- **Self-host on personal hardware** (a home desktop, or a spare Ryzen 5 3500U/8GB laptop) — the desktop measured as
  plenty capable, but was rejected on reliability/uptime grounds, not raw capability: this is a friend-facing server
  and tying it to home-network/power stability (and someone's personal machine staying on) isn't a good trade for a
  problem a cheap VPS solves cleanly. The laptop's specs were additionally below what's comfortable for this
  workload.
- **Rent a different VPS/cloud host** — chosen. Contabo's Cloud VPS 6 lands well under budget with real measured
  headroom (12GB vs. the ~8–9.5GB actually used).
- **Migrate the Discord bot off RCON onto Palworld's own REST API in the same effort** — Pocketpair has officially
  deprecated RCON in favor of a REST API (`GET /v1/api/players`, `POST /v1/api/announce`, etc., HTTP Basic Auth).
  Genuinely worth doing eventually, but rejected as in-scope *here*: it's an orthogonal change to the bot's control
  mechanism, not something this hosting migration needs to touch.

## Reasoning / tradeoffs

**Hybrid, not full exit.** Terraform state and backups staying on Oracle Object Storage avoids churn (state
migration, backup pipeline rework) that would provide no benefit, while still eliminating the actually costly/broken
part (ARM64 compute + box64). Oracle Object Storage is free-tier and involves no compute, so there's no meaningful
ongoing-charge risk left there once the game VM itself is decommissioned.

**Contabo's Terraform provider covers what's needed, with one real gap.** `contabo_instance` (with `user_data` for
cloud-init, same mechanism already used on Oracle) and `contabo_secret` (SSH key upload) worked as expected. Its
`contabo_firewall` resource, however, requires a **paid add-on** this order doesn't include — discovered the hard
way, as a real `402 Payment Required` against the live account, not from documentation. Packet filtering (SSH scoped
to the admin's IP, game + query UDP ports open, everything else denied) is implemented host-side via `ufw` in
cloud-init instead (see #99/PR #100) — same effect, no extra cost.

**Backups needed a real auth change, not just a config tweak.** Oracle's instance-principal mechanism
(`backup-iam.tf`) authenticates as "this specific Oracle VM's identity" — a Contabo VM has no such identity.
`backup.sh`/`restore.sh` now authenticate to Oracle Object Storage's S3-compatible endpoint via a dedicated,
least-privileged OCI Customer Secret Key (`infrastructure/terraform/backup-service-account.tf`), scoped to *only*
the backup bucket — deliberately not the general admin/Terraform credential, which would hand a public-facing VM
full tenancy access if it were ever compromised.

**Operational gotcha worth remembering, not just noting once:** changing `user_data` on an already-created
`contabo_instance` triggers a **full reinstall** — the disk is wiped and a new SSH host key is generated — it is
*not* an in-place metadata update, despite Terraform describing it as "modified in-place." Confirmed by observing
the instance's SSH host key change and a ~1 minute "Modifying..." apply, matching the timing of a real reinstall.
Any future change to `user_data` against a live instance that actually has world-save data on it must account for
this (back up first, expect the instance to be briefly unreachable and then come back as a fresh install).

## Status

Terraform has provisioned the Contabo instance (`infrastructure/terraform-contabo`), but as of this ADR it is not
yet reliably reachable over SSH — being worked through directly with Contabo support (see PR #100's discussion for
the diagnostic trail: reinstalls, SSH key propagation, and an unresponsive VNC console all pointed at a host-side
issue rather than a configuration bug in this repo).

The Oracle game VM ([`001-why-oracle.md`](001-why-oracle.md)) remains the live, production server until the Contabo
instance is verified reachable and stable. See [`docs/runbooks/contabo-cutover.md`](../runbooks/contabo-cutover.md)
for the exact steps to run once it is.
