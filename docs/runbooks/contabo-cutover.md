# Runbook: cutting the game server over to Contabo

One-time steps to run once the Contabo instance (`infrastructure/terraform-contabo`) is actually reachable over
SSH. See [`docs/decisions/006-migrate-to-contabo.md`](../decisions/006-migrate-to-contabo.md) for why this
migration exists and what stays on Oracle (Terraform state, world-save backups).

**Do not start this until the instance is confirmed reachable and stable.** A prior attempt found that changing
`infrastructure/terraform-contabo`'s `user_data` on an already-created instance triggers a full reinstall (wipes the
disk, new SSH host key) — don't touch that Terraform config again once real world-save data is on the box without
planning for that.

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
fresh create vs. a reinstall — don't assume `admin_ssh_public_key`'s `default_user` variable value in
`infrastructure/terraform-contabo/variables.tf` accurately reflects what actually landed in `/etc/passwd`; check for
real).

## 2. Move world-save data from the Oracle VM to Contabo

There's no shared storage between the two VMs, and the admin key doesn't necessarily let one VM SSH into the other
directly, so route it through your own machine — same underlying idea as
[`world-migration.md`](world-migration.md), just VM-to-VM instead of local-to-VM:

```
# Pull the current save down from the Oracle VM
scp -i <admin-key> -r <ADMIN_SSH_USER>@<oracle-ip>:/mnt/palworld-data/Pal/Saved/SaveGames/0/<WorldGUID> \
  /tmp/world-export

# Push it up to the Contabo VM (data directory is a plain folder here -- no
# separate block volume to mount first, see infrastructure/cloud-init/game-vm-contabo.yaml)
ssh -i <admin-key> <ADMIN_SSH_USER>@<contabo-ip> 'sudo mkdir -p /mnt/palworld-data/Pal/Saved/SaveGames/0'
scp -i <admin-key> -r /tmp/world-export <ADMIN_SSH_USER>@<contabo-ip>:/tmp/world-import
ssh -i <admin-key> <ADMIN_SSH_USER>@<contabo-ip> '
  sudo mv /tmp/world-import /mnt/palworld-data/Pal/Saved/SaveGames/0/<WorldGUID>
  sudo chown -R 1000:1000 /mnt/palworld-data/Pal/Saved/SaveGames/0/<WorldGUID>
'

rm -rf /tmp/world-export
```

The `chown 1000:1000` matters for the same reason it does in `world-migration.md` — it must match
`docker/compose.yml`'s `PUID`/`PGID`, or the container can't read/write the save.

**Do not stop or restart the Oracle server for this step** — copy from the live save, don't take Oracle down until
Contabo is verified working.

## 3. Deploy and start, without touching the live Oracle deployment

`.env.local` still points at Oracle at this point (the live production host) — don't edit it yet. Instead, make a
throwaway copy for validation:

```
cp .env.local .env.contabo.local
```

Edit `.env.contabo.local`'s `GAME_VM_HOST`, `ADMIN_SSH_USER`, and `ADMIN_SSH_PRIVATE_KEY_PATH` to point at the
Contabo instance (leave everything else — server name, passwords, ports, backup config — the same). Then:

```
scripts/deploy.sh .env.contabo.local
ssh -i <admin-key> <ADMIN_SSH_USER>@<contabo-ip> 'palworld-ctl start'
```

(`scripts/deploy.sh` accepts an optional env-file argument for exactly this — see its usage comment.)

## 4. Verify stability

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

Have players actually connect and confirm their base/character/progress is present (a clean start doesn't by
itself prove the right `WorldGUID` loaded if more than one exists under `SaveGames/0/`). Watch memory over a real
session, not just at startup — the Oracle problem only showed up over sustained real play, not immediately.

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
