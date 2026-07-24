# 002 — Why Docker for the Palworld server

## Decision

Run the Palworld dedicated server in Docker via the community-maintained
[`thijsvanloef/palworld-server-docker`](https://github.com/thijsvanloef/palworld-server-docker) image
(`docker/compose.yml`), rather than installing the server binary directly on the game VM.

## Alternatives considered

- **Bare-metal install on the game VM** (SteamCMD install directly onto the host) — no container overhead, but
  couples the server's runtime environment directly to the VM's OS packages, makes upgrades and config changes
  harder to reason about and roll back, and gives cloud-init nothing clean to template around.
- **A custom-built Docker image** — full control over the exact server version and startup behavior, but
  `thijsvanloef/palworld-server-docker` already provides actively maintained RCON support, env-driven
  configuration, and community-server mode; building and maintaining an equivalent image would be pure duplicated
  effort with no benefit for this project's needs.
- **A general-purpose game-server orchestration platform** (e.g. Pterodactyl) — overkill for a single game, single
  server, 3-person friend group; adds its own infrastructure (panel, daemon, database) to secure and maintain for
  no capability this project actually needs.

## Reasoning / tradeoffs

Docker gives environment-driven configuration (`docker/compose.yml`'s env vars map directly to
`infrastructure/cloud-init`'s templated values and `scripts/deploy.sh`'s `.env`), a documented `restart:
unless-stopped` policy that the [48h lifecycle manager](../../CLAUDE.md) relies on to bring the container back
after an RCON-triggered shutdown, and a clean upgrade path (pull a new image tag) without touching the host OS.
The tradeoff is one more moving part (Docker itself, plus the image's own release cadence) versus a bare install
— accepted because the image is actively maintained and the operational benefits (restart policy, config
isolation, easy rollback) directly support this project's automation goals rather than just being "best practice
for its own sake."
