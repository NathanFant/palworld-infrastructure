# Runbook: what to do once Oracle allocation lands

Tracks the infrastructure work that's already written and merged but can't be *applied* or *verified end-to-end*
until Oracle Always Free capacity actually frees up for this tenancy (see
[`capacity-retry.md`](capacity-retry.md) for why `terraform apply` currently fails and how the retry loop works).
This is the checklist to work through the moment `scripts/retry-apply.ps1` reports a successful apply.

## What's pending on the allocation

As of this checklist's last update, `terraform plan` in `infrastructure/terraform` shows these resources still
unapplied — everything else (VCN, subnets, NSGs, Object Storage bucket + lifecycle policy) is already live:

- `oci_core_instance.game` — the Ampere A1.Flex game VM (this is almost always the one actually blocked; see
  `capacity-retry.md`'s note on `E2.1.Micro`'s misleading `404` error if the bot VM is the one stuck instead).
- `oci_core_instance.bot` — the AMD E2.1.Micro bot VM.
- `oci_core_volume_attachment.world_data` — attaches the game VM's Block Volume, depends on the game VM existing.
- `oci_identity_dynamic_group.game_vm` + `oci_identity_policy.game_vm_backup_access` — instance-principal grant
  letting the game VM's backup service write to the Object Storage bucket, depends on the game VM's OCID existing.

## Steps once `terraform apply` succeeds

1. **Confirm the apply is actually complete and clean.**
   ```
   terraform plan
   ```
   should report no changes. Note `terraform output game_vm_public_ip` / `bot_vm_public_ip` (and the `_private_ip`
   outputs) — everything below needs them.

2. **Fill in the real host values in `.env.local`** (`GAME_VM_HOST`, `RCON_HOST` — same host, the game VM's public
   or private IP depending on the bot VM's network path — and once the bot itself runs from the bot VM rather than
   locally, its own `.env` there too). See `.env.example` for the full variable list.

3. **Deploy the Palworld server stack to the game VM.**
   ```
   scripts/deploy.sh
   ```
   Ships `docker/compose.yml`, `backups/backup.sh`/`restore.sh`, and a rendered `.env` to `/opt/palworld/` and pulls
   the pinned image. Does not start the container — that's a separate, deliberate step (see `CLAUDE.md`: only the
   container is started/stopped, never treated as part of "deploying").

4. **Migrate the existing "poop" world save** before the first real start, per
   [`world-migration.md`](world-migration.md) — copy the save onto the Block Volume and `chown` it to match the
   container's `PUID`/`PGID`, before anyone connects, so the group doesn't start a second, empty world by mistake.

5. **Start the server and verify it's actually reachable.**
   - `/server start` in Discord (or `palworld-ctl start` directly over the bot's forced-command SSH key, for a
     lower-level check).
   - Watch `docker compose -f /opt/palworld/docker-compose.yml logs -f` on the game VM for the world loading
     without errors.
   - Have one of the players who was in the original save actually connect and confirm their base/character/
     progress is present — per `world-migration.md`, a clean start with no errors doesn't by itself prove the
     *right* world loaded.

6. **Verify the bot's live integrations against the real infrastructure**, not just its unit tests:
   - `/server status` reflects the real container state and RCON player count.
   - The voice-presence embed updates when someone joins/leaves the watched channel.
   - The status heartbeat channel posts an online transition message and starts showing live uptime.

7. **Run one real backup and one real restore drill** before trusting either against the live world:
   - Confirm `palworld-backup@daily.service` (or the tier you want to test) actually uploads an object to the
     `palworld-backups` bucket under the expected `<tier>/palworld-<timestamp>.tar.gz` key.
   - Run `restore.sh` against that object into a staging location (never auto-overwrite the live save — see
     [`disaster-recovery.md`](../disaster-recovery.md)) and confirm the archive is intact and readable.

8. **Do a real end-to-end restart-with-countdown test** on the lifecycle manager (`discord-bot/src/services/
   lifecycleManager.ts`) at a non-peak time, rather than trusting its unit tests alone for a behavior that only
   fully exercises against the real RCON `Shutdown` broadcast and Docker's `restart: unless-stopped` policy —
   ideally by temporarily lowering `SERVER_RESTART_INTERVAL_HOURS` rather than waiting a real 48 hours.

9. **Close out this checklist** by updating this file (or opening a short follow-up issue, labeled `area:infra`)
   noting the date allocation actually landed and which of the above steps are done, so the next person/agent
   doesn't have to re-derive whether this has already happened.

## If something in this list is stale

Terraform's own state (`terraform state list` / `terraform plan`) is the source of truth for what's actually been
applied — if it disagrees with the "What's pending" list above, trust the state, not this document, and update
this file to match.
