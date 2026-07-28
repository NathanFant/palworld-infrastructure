# Runbook: migrating an existing world save onto the new server

One-time migration of a world you've already been playing (locally, or on a
different host) onto this project's game VM.

**Important, verified directly (issue #106): the dedicated server generates its own
`WorldGUID` on a truly fresh boot and ignores any folder you pre-place, even if it's
the only one present.** Pre-placing a folder named after your own save's `WorldGUID`
before the container's very first start does **not** work — the server creates a
new, empty world alongside it instead. The real procedure:

1. Start the container fresh at least once with an *empty* `SaveGames/0/` (or however
   it already is) and let it generate its own `WorldGUID` folder.
2. Stop the container (`palworld-ctl stop`).
3. Move your real save's *files* into that server-generated `WorldGUID` folder
   (replacing its contents) — not a folder you create yourself.
4. Restart. Once a container has gone through this once, subsequent restarts
   correctly reuse the same folder without regenerating a new empty world.

Steps 1 and 3 below assume the container has already been started once and you know
its generated `WorldGUID`. Verified against `thijsvanloef/palworld-server-docker:latest`
/ Palworld dedicated server v1.0.1.100619 — worth re-checking if either changes
meaningfully.

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
