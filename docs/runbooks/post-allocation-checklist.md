# Runbook: deploying once the game VM is up

Originally tracked the infrastructure work blocked on Oracle Always Free capacity (see
[`capacity-retry.md`](capacity-retry.md)). As of
[`docs/decisions/005-consolidate-bot-onto-game-vm.md`](../decisions/005-consolidate-bot-onto-game-vm.md), the
Discord bot no longer needs its own VM allocation at all — it runs as a second container on the same game VM. The
game VM (`oci_core_instance.game`) has been live and confirmed healthy since 2026-07-25 (SSH reachable, cloud-init
completed, Docker installed, Block Volume mounted at `/mnt/palworld-data`). This checklist is now a straight
deployment sequence, not an allocation-blocked waiting list.

## Steps

1. **Confirm `terraform plan` is clean.**
   ```
   terraform plan
   ```
   should report no changes. Note `terraform output game_vm_public_ip` (and `_private_ip`) — everything below needs
   it.

2. **Fill in the real host values in `.env.local`** — `GAME_VM_HOST` and `RCON_HOST` both resolve to the same game
   VM; since the bot now runs on that same VM (`network_mode: host`), its own runtime config uses `127.0.0.1` for
   both rather than a second host's IP. See `.env.example` for the full variable list.

3. **Deploy the Palworld server stack.**
   ```
   scripts/deploy.sh
   ```
   Ships `docker/compose.yml`, `backups/backup.sh`/`restore.sh`, and a rendered `.env` to `/opt/palworld/` and pulls
   the pinned image. Does not start the container — that's a separate, deliberate step (see `CLAUDE.md`: only the
   Palworld container is started/stopped, never treated as part of "deploying").

4. **Migrate the existing "poop" world save** before the first real start, per
   [`world-migration.md`](world-migration.md) — copy the save onto the Block Volume and `chown` it to match the
   container's `PUID`/`PGID`, before anyone connects, so the group doesn't start a second, empty world by mistake.

5. **Deploy and start the Discord bot.**
   ```
   scripts/deploy-bot.sh
   ```
   Ships `discord-bot/docker-compose.yml`, the bot's forced-command SSH key, and a rendered `.env` to
   `/opt/palworld-bot/` on the same game VM, then pulls and starts it (unlike `deploy.sh`, this one does start the
   container — the bot has no "intentionally off" state of its own).

6. **Start the Palworld server and verify it's actually reachable.**
   - `/server start` in Discord (or `palworld-ctl start` directly over the bot's forced-command SSH key, for a
     lower-level check).
   - Watch `docker compose -f /opt/palworld/docker-compose.yml logs -f` on the game VM for the world loading
     without errors.
   - Have one of the players who was in the original save actually connect and confirm their base/character/
     progress is present — per `world-migration.md`, a clean start with no errors doesn't by itself prove the
     *right* world loaded.

7. **Verify the bot's live integrations against the real infrastructure**, not just its unit tests:
   - `/server status` reflects the real container state and RCON player count.
   - The voice-presence embed updates when someone joins/leaves the watched channel.
   - The status heartbeat channel posts an online transition message and starts showing live uptime.

8. **Run one real backup and one real restore drill** before trusting either against the live world:
   - Confirm `palworld-backup@daily.service` (or the tier you want to test) actually uploads an object to the
     `palworld-backups` bucket under the expected `<tier>/palworld-<timestamp>.tar.gz` key.
   - Run `restore.sh` against that object into a staging location (never auto-overwrite the live save — see
     [`disaster-recovery.md`](../disaster-recovery.md)) and confirm the archive is intact and readable.

9. **Do a real end-to-end restart-with-countdown test** on the lifecycle manager (`discord-bot/src/services/
   lifecycleManager.ts`) at a non-peak time, rather than trusting its unit tests alone for a behavior that only
   fully exercises against the real RCON `Shutdown` broadcast and Docker's `restart: unless-stopped` policy —
   ideally by temporarily lowering `SERVER_RESTART_INTERVAL_HOURS` rather than waiting a real 48 hours.

10. **Close out this checklist** by updating this file (or opening a short follow-up issue) noting which of the
    above steps are done, so the next person/agent doesn't have to re-derive whether this has already happened.

## If something in this list is stale

Terraform's own state (`terraform state list` / `terraform plan`) is the source of truth for what's actually been
applied — if it disagrees with anything above, trust the state, not this document, and update this file to match.
