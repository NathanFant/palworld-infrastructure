# Runbook: cutting the game server over to Contabo

One-time steps to run once the Contabo instance (`infrastructure/terraform-contabo`) is actually reachable over
SSH. See [`docs/decisions/006-migrate-to-contabo.md`](../decisions/006-migrate-to-contabo.md) for why this
migration exists and what stays on Oracle (Terraform state, world-save backups).

**Do not start this until the instance is confirmed reachable and stable.** A prior attempt found that changing
`infrastructure/terraform-contabo`'s `user_data` on an already-created instance triggers a full reinstall (wipes the
disk, new SSH host key) — don't touch that Terraform config again once real world-save data is on the box without
planning for that.

**World-save data moves last, not first.** The Oracle server is live and being actively played on while this
migration is in progress — don't touch it, and don't pull the real save off it, until every other step below is
already validated. Steps 1–3 deliberately validate Contabo using a fresh/throwaway world instead, so the live game
is completely undisturbed until the final cutover moment.

## 1. Verify the instance itself

```
ssh -i <admin-key> <ADMIN_SSH_USER>@<contabo-ip> '
  cloud-init status --wait
  sudo ufw status verbose
  sudo systemctl is-active docker
  whoami
'
```

Confirm: cloud-init finished with no errors, `ufw` is active with exactly three allow rules (SSH scoped to your
`admin_ssh_cidr`, the game UDP port, the query UDP port) and a default-deny policy, Docker is active, and note the
actual login username (this session saw Contabo's real default user vary between "ubuntu" and "admin" across a
fresh create vs. a reinstall — don't assume `compute.tf`'s hardcoded `default_user = "admin"` attribute on
`contabo_instance` accurately reflects what actually landed in `/etc/passwd`; check for real).

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

Once this holds up, stop the container (`palworld-ctl stop`) — do **not** leave the throwaway world's save in place
under `/mnt/palworld-data`; it needs to be cleared before the real save lands in step 4.

## 4. Only now: move the real world-save data over, and cut everything over together

This is the one step that touches the live Oracle server, so do it as a single, short-disruption window (ideally
when players are already offline, since it needs a brief pause on Oracle to guarantee the copied save is
consistent) rather than spreading it out:

```
# Stop the Oracle server so the save isn't being written mid-copy
ssh -i <admin-key> <ADMIN_SSH_USER>@<oracle-ip> 'palworld-ctl stop'

# Pull the current save down from the Oracle VM
scp -i <admin-key> -r <ADMIN_SSH_USER>@<oracle-ip>:/mnt/palworld-data/Pal/Saved/SaveGames/0/<WorldGUID> \
  /tmp/world-export

# Clear the throwaway world from step 2, then push the real save up to Contabo
# (data directory is a plain folder here -- no separate block volume to mount
# first, see infrastructure/cloud-init/game-vm-contabo.yaml)
ssh -i <admin-key> <ADMIN_SSH_USER>@<contabo-ip> '
  sudo rm -rf /mnt/palworld-data/Pal/Saved/SaveGames/0/*
  sudo mkdir -p /mnt/palworld-data/Pal/Saved/SaveGames/0
'
scp -i <admin-key> -r /tmp/world-export <ADMIN_SSH_USER>@<contabo-ip>:/tmp/world-import
ssh -i <admin-key> <ADMIN_SSH_USER>@<contabo-ip> '
  sudo mv /tmp/world-import /mnt/palworld-data/Pal/Saved/SaveGames/0/<WorldGUID>
  sudo chown -R 1000:1000 /mnt/palworld-data/Pal/Saved/SaveGames/0/<WorldGUID>
  palworld-ctl start
'

rm -rf /tmp/world-export
```

The `chown 1000:1000` matters for the same reason it does in [`world-migration.md`](world-migration.md) — it must
match `docker/compose.yml`'s `PUID`/`PGID`, or the container can't read/write the save.

Have a player connect and confirm their actual base/character/progress is present (a clean start doesn't by itself
prove the right `WorldGUID` loaded). Keep the Oracle VM's copy of the save untouched and the VM itself not
destroyed yet — it's your rollback path if something's wrong with the transferred save.

## 5. Cut the bot over (only after step 4 is confirmed good)

Update the real `.env.local` (`GAME_VM_HOST`, `PALWORLD_PUBLIC_HOST`, `ADMIN_SSH_USER`, and the corresponding
`GAME_VM_SSH_*` fields the deployed bot itself uses) to point at Contabo, then redeploy:

```
scripts/deploy-bot.sh
```

Delete `.env.contabo.local` once the real `.env.local` is updated — it was only ever a throwaway validation copy.

## 6. Only after Contabo has been stable for a while

- Clean up `docker/compose.yml`: remove `ARM64_DEVICE` and all `BOX64_DYNAREC_*` settings (meaningless on native
  x86). Keep the item/building count caps and invader-raids-disabled settings — those were sensible hygiene
  independent of the ARM64/box64 problem, not part of the root cause.
- Run `terraform destroy` against the Oracle *compute* resources in `infrastructure/terraform` once you're
  confident Contabo is the permanent home — this is what actually stops further Oracle compute charges. Scope this
  carefully: `infrastructure/terraform` also now contains `backup-service-account.tf`'s IAM resources and the
  Object Storage bucket, both of which must survive (backups and Terraform state stay on Oracle indefinitely — see
  the ADR). Don't blanket-destroy the whole directory's state.
- File a follow-up ticket to actually remove the now-dead Oracle compute/network Terraform files once Oracle
  compute is fully decommissioned.
