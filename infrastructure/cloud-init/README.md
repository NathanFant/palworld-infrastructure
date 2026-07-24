# cloud-init

VM bootstrap for both hosts, supplied as Terraform `user_data`. Neither file places
application code — they only prepare the environment (Docker, mounts, users,
hardening). Deploying `docker/compose.yml` and the bot's own image is a separate,
later step (`scripts/deploy.sh`).

## `game-vm.yaml`

Installs Docker, formats/mounts the attached Block Volume at `/mnt/palworld-data`,
installs fail2ban + unattended-upgrades, and — the important part — creates a
`palworld-bot` user whose SSH key is restricted to only ever run
`/usr/local/bin/palworld-ctl`, via an `authorized_keys` forced command:

```
command="/usr/local/bin/palworld-ctl $SSH_ORIGINAL_COMMAND",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty <public-key>
```

Whatever command the bot's SSH client sends (`ssh palworld-bot@game-vm start`) is
captured in `$SSH_ORIGINAL_COMMAND` and passed as `$1` to `palworld-ctl` — the key can
never open an interactive shell or run anything else. This is the whole security
argument behind CLAUDE.md's "SSH with a forced command, not a custom API" decision:
the attack surface is exactly `palworld-ctl`'s `case` statement, not a general shell.

### Generating and injecting the bot's SSH keypair

1. Generate a dedicated keypair (don't reuse a personal one): `ssh-keygen -t ed25519 -f palworld-bot-key -C "palworld-discord-bot"`.
2. The **private** key: the bot VM needs it at the path pointed to by `GAME_VM_SSH_PRIVATE_KEY_PATH` (`.env.example`). Never commit it.
3. The **public** key: passed into Terraform as a variable and substituted into this file via `templatefile()` at the `${palworld_bot_ssh_public_key}` placeholder — wired in the Terraform game-VM ticket, not here.

### Assumptions worth checking at real deploy time

- `/dev/oracleoci/oraclevdb` is Oracle's documented stable device path for the second
  paravirtualized-attached Block Volume (the boot volume is `oraclevda`). Verify this
  against the actual instance once created — if OCI ever changes attachment type
  (iSCSI vs paravirtualized) this path assumption would need to change too.
- `/opt/palworld/docker-compose.yml` is the fixed path convention `palworld-ctl`
  assumes. The Phase 2 deploy tooling must place the compose file there.

## `bot-vm.yaml`

Same Docker install, no forced-command SSH setup (this host isn't the target of
restricted access — it's the one holding the private key and initiating connections
outward). Normal admin SSH access applies here, gated by the security list's
`admin_ssh_cidr` restriction from the networking ticket, same as the game VM.
