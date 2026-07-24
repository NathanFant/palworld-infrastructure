# Runbook: migrating an existing world save onto the new server

One-time migration of a world you've already been playing (locally, or on a
different host) onto this project's game VM, before its first start.

## 1. Find your existing save

Palworld saves live in a folder named after a world GUID, containing (at minimum)
`Level.sav`, `LevelMeta.sav`, and `WorldOption.sav`, plus a `Players/` subfolder.
Where that GUID folder lives depends on how you were hosting:

- **Dedicated server (Windows, run directly)**: under that server install's
  `Pal\Saved\SaveGames\0\<WorldGUID>\`.
- **"Host from save data" (co-op via the base game)**: under Steam's per-user data,
  typically `<PalworldInstall>\Pal\Saved\SaveGames\<SteamID64>\<WorldGUID>\`.
- **Already running in Docker somewhere else**: under that container's mounted data
  volume at `Pal/Saved/SaveGames/0/<WorldGUID>/`.

If you're not sure which folder is the right one, look for the one whose `Level.sav`
modification date matches when you last played, and/or check `WorldOption.sav`'s
folder for a `Players/` directory with more than one `.sav` file (multiplayer saves).

## 2. Copy it to the game VM

The game VM's Block Volume is mounted at `/mnt/palworld-data`, which
`docker/compose.yml` maps to the container's `/palworld`. The container expects the
same relative layout, so the destination is:

```
/mnt/palworld-data/Pal/Saved/SaveGames/0/<WorldGUID>/
```

Using the admin SSH key (see `scripts/deploy.sh` / `.env.example`'s `ADMIN_SSH_*`
fields), from a machine with the source save available:

```
scp -i <admin-key> -r "<local-path-to-WorldGUID-folder>" \
  <ADMIN_SSH_USER>@<GAME_VM_HOST>:/tmp/world-import

ssh -i <admin-key> <ADMIN_SSH_USER>@<GAME_VM_HOST> '
  sudo mkdir -p /mnt/palworld-data/Pal/Saved/SaveGames/0
  sudo mv /tmp/world-import /mnt/palworld-data/Pal/Saved/SaveGames/0/<WorldGUID>
  sudo chown -R 1000:1000 /mnt/palworld-data/Pal/Saved/SaveGames/0/<WorldGUID>
'
```

The `chown` to `1000:1000` matters — it must match `docker/compose.yml`'s
`PUID`/`PGID`, or the container won't have permission to read/write the save.

## 3. Verify

1. Deploy and start the server (`scripts/deploy.sh`, then `/server start` in Discord
   or `palworld-ctl start` directly).
2. Check the container logs for the world loading without errors:
   `docker compose -f /opt/palworld/docker-compose.yml logs -f`.
3. Have one of the players who was in the original save connect and confirm their
   base/character/progress is actually there — a clean server start with no errors
   doesn't by itself prove the *right* world loaded if multiple `WorldGUID` folders
   exist under `SaveGames/0/`.

## If something looks wrong

Don't delete anything — move the suspect folder aside (`mv ... .bak`) rather than
removing it, and see `docs/runbooks/world-restore.md` for restoring from a backup
once Phase 3's `backup.sh` exists.
