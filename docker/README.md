# docker/

`compose.yml` defines the Palworld dedicated server service. It's not run from here
directly in production — `scripts/deploy.sh` (a companion ticket) copies this file,
plus a `.env` rendered from the repo root's `.env.local`, to
`/opt/palworld/docker-compose.yml` and `/opt/palworld/.env` on the game VM. That exact
path is hardcoded in `infrastructure/cloud-init/game-vm.yaml`'s embedded `palworld-ctl`
script (`start`/`stop`/`status` all operate against `docker compose -f
/opt/palworld/docker-compose.yml`), so don't change it in one place without the other.

## Local testing

You can run this compose file locally (e.g. on the game VM directly, or on any Docker
host) by placing a `.env` alongside it with the `PALWORLD_*`/`RCON_PORT` values from
`.env.example`, then:

```
docker compose -f docker/compose.yml up -d
```

## Why `BACKUP_ENABLED: "false"`

The `thijsvanloef/palworld-server-docker` image ships its own local backup/cron
feature. It's explicitly disabled here — Phase 3's `backup.sh` owns backups (RCON
`Save` + upload to Object Storage with a real, documented retention policy). Leaving
the image's built-in backups on as well would silently accumulate a second, unmanaged
set of local backups on the same disk indefinitely.
