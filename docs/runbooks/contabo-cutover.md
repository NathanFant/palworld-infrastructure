# Runbook: cutting the game server over to Contabo

One-time steps to run once the Contabo instance (`infrastructure/terraform-contabo`) is actually reachable over
SSH. See [`docs/decisions/006-migrate-to-contabo.md`](../decisions/006-migrate-to-contabo.md) for why this
migration exists and what stays on Oracle (Terraform state, world-save backups).

**Do not start this until the instance is confirmed reachable and stable.** A prior attempt found that changing
`infrastructure/terraform-contabo`'s `user_data` on an already-created instance triggers a full reinstall (wipes the
disk, new SSH host key) — don't touch that Terraform config again once real world-save data is on the box without
planning for that.

**World-save data moves last, not first.** Whatever host currently has your most up-to-date save — a live server,
or your own local machine — shouldn't be touched until every other step below is already validated. Steps 1–3
deliberately validate Contabo using a fresh/throwaway world instead, so wherever the real game is actually being
played stays completely undisturbed until the final cutover moment (confirm with whoever's playing which copy —
Oracle, local, or otherwise — is actually the current one before pulling from it in step 4).

## 1. Verify the instance itself

```
ssh -i <admin-key> ubuntu@<contabo-ip> '
  cloud-init status --long
  sudo ufw status verbose
  sudo systemctl is-active docker
  which aws && aws --version
  sudo ls -la /home/palworld-bot/.aws/
'
```

**The real, working admin login is `ubuntu`, not `admin`.** Contabo's own `defaultUser` API field (hardcoded to
`"admin"` in `compute.tf`) never fully provisions — its `chpasswd` step fails because no `rootPassword` secret is
supplied, and the `admin` account doesn't actually get created at all. This is expected and harmless: the real
admin access comes from cloud-init's own `users: - default` entry, which maps to this base image's actual default
user (`ubuntu`) — a completely separate mechanism from Contabo's `defaultUser` field. Use `ADMIN_SSH_USER=ubuntu`
in any `.env*` file targeting this instance.

Confirm: `cloud-init status --long` finished with no errors (a fresh instance built from the current cloud-init
should be fully clean — see #103 for two bugs, since fixed, that previously caused real errors here around AWS CLI
install and the backup credentials file), `ufw` is active with exactly three allow rules (SSH scoped to your
`admin_ssh_cidr`, the game UDP port, the query UDP port) and a default-deny policy, Docker is active, `aws --version`
works, and `/home/palworld-bot/.aws/credentials` exists (owned by `palworld-bot`, mode 600).

## 2. Deploy and start with a fresh/throwaway world — no Oracle data involved yet

`.env.local` still points at Oracle at this point (the live production host, currently being played on) — don't
edit it yet, and don't touch the Oracle VM at all in this step. Make a throwaway copy for validation instead:

```
cp .env.local .env.contabo.local
```

Edit `.env.contabo.local`'s `GAME_VM_HOST`, `ADMIN_SSH_USER`, and `ADMIN_SSH_PRIVATE_KEY_PATH` to point at the
Contabo instance (leave everything else — server name, passwords, ports, backup config — the same). Then:

```
scripts/deploy.sh .env.contabo.local
ssh -i <admin-key> <ADMIN_SSH_USER>@<contabo-ip> 'palworld-ctl start'
```

(`scripts/deploy.sh` accepts an optional env-file argument for exactly this — see its usage comment.) With no
existing save present, the Palworld container generates a brand-new world on first start — that's fine and
expected here; the point of this step is exercising the real container/emulation-free stack, not the real data.

## 3. Verify stability on the fresh world

This is the actual point of the migration — don't skip it or treat a clean start as sufficient on its own:

```
ssh -i <admin-key> <ADMIN_SSH_USER>@<contabo-ip> '
  docker compose -f /opt/palworld/docker-compose.yml ps
  free -h
  ps aux | grep -i palserver
'
```

Compare against the two baselines already established this session:

- **Oracle/box64 (the problem)**: ~30GB RSS / ~14GB swap within minutes of a restart, zero players connected.
- **Native x86, no emulation (the target)**: ~8–9.5GB RAM, 4–6 CPU cores, with up to 3 players connected.

Let it run for a real observation window (this project's own box64 investigation used 15–21 minute windows at
minimum) — the Oracle problem only showed up over sustained runtime, not immediately at startup. Have someone
connect to the throwaway world just to confirm join/play actually works end-to-end (movement, building, saving) —
it doesn't need to be a real play session, just a functional smoke test.

**Before stopping, note the server's own generated `WorldGUID`** — you'll need it in step 4:

```
ssh -i <admin-key> <ADMIN_SSH_USER>@<contabo-ip> 'sudo ls /mnt/palworld-data/Pal/Saved/SaveGames/0/'
```

Then stop the container (`palworld-ctl stop`). **Do not delete or rename this folder** — unlike what you might
expect, the real save's files get moved *into* it in step 4, not alongside it (see below).

## 4. Only now: move the real world-save data over, and cut everything over together

**Important, verified directly (issue #106): the dedicated server generates its own `WorldGUID` on a truly fresh
boot and ignores any differently-named folder you pre-place — even if it's the only one present.** Introducing the
real save under its own original `WorldGUID` name does **not** work; the server just creates a second, empty world
next to it and uses that instead. The fix: move the real save's *files* into the folder the server already
generated for itself in step 2/3 (noted above), replacing its contents — don't create a new folder named after the
source world's own GUID.

This is the one step that touches the live source of truth for your world, so do it as a single, short-disruption
window (ideally when nobody's actively playing, since it needs a brief pause to guarantee the copied save is
consistent) rather than spreading it out. Substitute `<SOURCE_HOST>` with wherever your current, most up-to-date
save actually lives — this may be a live server (stop it first the same way) or your own local machine (Palworld's
local/"host from save" saves live under `%LOCALAPPDATA%\Pal\Saved\SaveGames\<SteamID64>\<WorldGUID>\` on Windows):

```
# If the source is a running server, stop it first so the save isn't being written mid-copy
ssh -i <admin-key> <ADMIN_SSH_USER>@<source-host> 'palworld-ctl stop'

# Pull the current save down (adjust the source path per above)
scp -i <admin-key> -r <ADMIN_SSH_USER>@<source-host>:/mnt/palworld-data/Pal/Saved/SaveGames/0/<WorldGUID> \
  /tmp/world-export

# Replace the CONTENTS of the server-generated GUID folder from step 2/3 -- do not
# create a new folder named after the source world's own <WorldGUID>. No separate
# block volume to mount here -- unlike Oracle, Contabo bundles storage into the
# instance itself (see infrastructure/cloud-init/game-vm-contabo.yaml).
ssh -i <admin-key> <ADMIN_SSH_USER>@<contabo-ip> '
  sudo rm -rf /mnt/palworld-data/Pal/Saved/SaveGames/0/<GENERATED_WORLDGUID_FROM_STEP_3>
'
scp -i <admin-key> -r /tmp/world-export <ADMIN_SSH_USER>@<contabo-ip>:/tmp/world-import
ssh -i <admin-key> <ADMIN_SSH_USER>@<contabo-ip> '
  sudo mv /tmp/world-import /mnt/palworld-data/Pal/Saved/SaveGames/0/<GENERATED_WORLDGUID_FROM_STEP_3>
  sudo chown -R 1000:1000 /mnt/palworld-data/Pal/Saved/SaveGames/0/<GENERATED_WORLDGUID_FROM_STEP_3>
'

rm -rf /tmp/world-export
```

**If the source save was ever played on Windows** (including "host from save data" co-op via the base game — true
for this project's own save), move aside any `WorldOption.sav` in the copied folder before starting, or RCON/REST
API authentication will silently fail with "AdminPassword is empty" even though the password is correct everywhere
else. Hit this exact issue during this project's own cutover -- see #105, root cause and a fix proposed upstream at
[thijsvanloef/palworld-server-docker#886](https://github.com/thijsvanloef/palworld-server-docker/issues/886) /
[#910](https://github.com/thijsvanloef/palworld-server-docker/pull/910):

```
ssh -i <admin-key> <ADMIN_SSH_USER>@<contabo-ip> '
  sudo mv /mnt/palworld-data/Pal/Saved/SaveGames/0/<GENERATED_WORLDGUID_FROM_STEP_3>/WorldOption.sav \
    /mnt/palworld-data/Pal/Saved/SaveGames/0/<GENERATED_WORLDGUID_FROM_STEP_3>/WorldOption.sav.bak
'
```

Either way, now start the server:

```
ssh -i <admin-key> <ADMIN_SSH_USER>@<contabo-ip> 'palworld-ctl start'
```

The `chown 1000:1000` matters for the same reason it does in [`world-migration.md`](world-migration.md) — it must
match `docker/compose.yml`'s `PUID`/`PGID`, or the container can't read/write the save.

Verify the real data actually loaded (don't just trust a clean/healthy container start):

```
ssh -i <admin-key> <ADMIN_SSH_USER>@<contabo-ip> '
  sudo docker exec palworld-palworld-1 ls -la /palworld/Pal/Saved/SaveGames/0/<GENERATED_WORLDGUID_FROM_STEP_3>/Level.sav
'
```

`Level.sav`'s size should match the source save's exactly (a fresh/empty world's `Level.sav` is only a few KB; a
real, played world is typically several MB). Have a player connect and confirm their actual base/character/progress
is present — file size matching is good evidence but isn't the same as someone actually confirming their progress
is there. Keep the source save's original copy around until this is confirmed — it's your rollback path if
something's wrong with the transferred data.

## 5. Cut the bot over (only after step 4 is confirmed good)

**Stop the old bot deployment first** — the bot has no built-in awareness of "another instance of me is already
running elsewhere," so leaving the old host's bot container up while starting a new one on Contabo means two
instances both connect to the same Discord application at once (duplicate/conflicting status messages, doubled
slash-command handling):

```
ssh -i <admin-key> <ADMIN_SSH_USER>@<old-host> 'cd /opt/palworld-bot && sudo -u bot docker compose down'
```

Then update the real `.env.local` (`GAME_VM_HOST`, `PALWORLD_PUBLIC_HOST`, `ADMIN_SSH_USER`, and the corresponding
`GAME_VM_SSH_*` fields the deployed bot itself uses) to point at Contabo, then redeploy:

```
scripts/deploy-bot.sh
```

Delete `.env.contabo.local` once the real `.env.local` is updated — it was only ever a throwaway validation copy.

## 6. Only after Contabo has been stable for a while

- ~~Clean up `docker/compose.yml`: remove all `BOX64_DYNAREC_*` settings (meaningless on native x86)~~ — done, see
  #108/PR #109. Item/building count caps and invader-raids-disabled were kept — sensible hygiene independent of
  the ARM64/box64 problem, not part of the root cause.
- Run `terraform destroy` against the Oracle *compute* resources in `infrastructure/terraform` once you're
  confident Contabo is the permanent home — this is what actually stops further Oracle compute charges. Scope this
  carefully: `infrastructure/terraform` also now contains `backup-service-account.tf`'s IAM resources and the
  Object Storage bucket, both of which must survive (backups and Terraform state stay on Oracle indefinitely — see
  the ADR). Don't blanket-destroy the whole directory's state.
- File a follow-up ticket to actually remove the now-dead Oracle compute/network Terraform files once Oracle
  compute is fully decommissioned.
