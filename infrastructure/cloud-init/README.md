# cloud-init

VM bootstrap for the game VM, the only host in this project (see
[`docs/decisions/005-consolidate-bot-onto-game-vm.md`](../../docs/decisions/005-consolidate-bot-onto-game-vm.md)
for why the Discord bot runs here too, as a second Docker Compose project, rather
than on its own host). `game-vm.yaml` only prepares the environment (Docker, the
mounted Block Volume, control users, hardening) — it doesn't place application code.
Deploying `docker/compose.yml` and `discord-bot/docker-compose.yml` are separate,
later steps (`scripts/deploy.sh` and `scripts/deploy-bot.sh`).

## `game-vm.yaml`

Installs Docker, formats/mounts the attached Block Volume at `/mnt/palworld-data`,
installs fail2ban + unattended-upgrades, and creates two single-purpose users:

- **`palworld-bot`** — SSH key restricted to only ever run `/usr/local/bin/palworld-ctl`,
  via an `authorized_keys` forced command:

  ```
  command="/usr/local/bin/palworld-ctl $SSH_ORIGINAL_COMMAND",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty <public-key>
  ```

  Whatever command the bot's SSH client sends (`ssh palworld-bot@127.0.0.1 start`) is
  captured in `$SSH_ORIGINAL_COMMAND` and passed as `$1` to `palworld-ctl` — the key can
  never open an interactive shell or run anything else. This is the whole security
  argument behind `CLAUDE.md`'s "SSH with a forced command, not a custom API" decision:
  the attack surface is exactly `palworld-ctl`'s `case` statement, not a general shell.
  Kept deliberately separate from the `bot` user below even though both now live on
  the same VM — this account's only capability is the forced-command shim, nothing else.
- **`bot`** — an ordinary user (member of the `docker` group) that owns
  `/opt/palworld-bot` and runs the Discord bot's own Docker Compose project. No SSH
  restrictions of its own; it's not the target of any remote access, forced-command or
  otherwise.

### Generating and injecting the bot's SSH keypair

1. Generate a dedicated keypair (don't reuse a personal one): `ssh-keygen -t ed25519 -f palworld-bot-key -C "palworld-discord-bot"`.
2. The **private** key: the Discord bot container needs it at the path pointed to by `GAME_VM_SSH_PRIVATE_KEY_PATH` (`.env.example`) so it can authenticate as `palworld-bot` over loopback SSH. Never commit it.
3. The **public** key: passed into Terraform as a variable and substituted into this file via `templatefile()` at the `${palworld_bot_ssh_public_key}` placeholder — wired in the Terraform game-VM ticket, not here.

### Why SSH-over-loopback instead of a Docker socket mount

The bot's control path is `ssh palworld-bot@127.0.0.1 {start|stop|status}` — a real
network hop, just one that never leaves the host. The alternative (mounting
`/var/run/docker.sock` into the bot container so it can run `docker compose` directly)
would remove that hop entirely, but hands the container root-equivalent access to the
host — a well-known container-escape risk not worth taking just to save one SSH call.
The forced-command pattern keeps working exactly as designed even with both processes
on one VM.

### Assumptions worth checking at real deploy time

- `/dev/oracleoci/oraclevdb` is Oracle's documented stable device path for the second
  paravirtualized-attached Block Volume (the boot volume is `oraclevda`). Verified
  against the actual instance once created — see the world-migration runbook.
- `/opt/palworld/docker-compose.yml` and `/opt/palworld-bot/docker-compose.yml` are the
  fixed path conventions `palworld-ctl` and `scripts/deploy-bot.sh` respectively assume.

### Admin SSH access

Separate from the bot's forced-command key above: `oci_core_instance.game` sets
`metadata.ssh_authorized_keys` to `var.admin_ssh_public_key`, which OCI/cloud-init
merges into the default `ubuntu` user's `authorized_keys` — a real shell, used by
`scripts/deploy.sh`, `scripts/deploy-bot.sh`, and for general debugging. This is only
read by cloud-init at **first boot** — changing `admin_ssh_public_key` and re-applying
against an already-launched instance won't take effect; the instance would need to be
destroyed and recreated to pick up a new key.
