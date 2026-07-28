# Runbook: migrating an existing world save onto the new server

One-time migration of a world you've already been playing (locally, or on a
different host) onto this project's game VM.

**Important, verified directly (issue #106): the dedicated server generates its own
`WorldGUID` on a truly fresh boot and ignores any folder you pre-place, even if it's
the only one present.** Pre-placing a folder named after your own save's `WorldGUID`
before the container's very first start does **not** work — the server creates a
new, empty world alongside it instead. The steps below (2 and 3 in particular)
account for this: boot the target once to let it generate its own `WorldGUID`
folder, *then* swap your real save's files into that folder — never create a new
folder named after your own save's original `WorldGUID`. Verified against
`thijsvanloef/palworld-server-docker:latest` / Palworld dedicated server
v1.0.1.100619 — worth re-checking if either changes meaningfully.

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

## 2. Boot the target server once to establish its own WorldGUID

Deploy and start the server with **no save data of your own in place yet**
(`scripts/deploy.sh`, then `/server start` in Discord or `palworld-ctl start`
directly). On a truly fresh `/mnt/palworld-data`, the container generates its own
new world and its own `WorldGUID` folder — this is expected and is *not* the world
you're about to replace, just a placeholder the server needs to create for itself.

Find the `WorldGUID` it generated:

```
ssh -i <admin-key> <ADMIN_SSH_USER>@<GAME_VM_HOST> 'sudo ls /mnt/palworld-data/Pal/Saved/SaveGames/0/'
```

Then stop it again (`palworld-ctl stop`) before continuing — you're about to replace
that folder's contents, not run it as-is.

## 3. Replace the generated world's contents with your real save

The game VM's Block Volume is mounted at `/mnt/palworld-data`, which
`docker/compose.yml` maps to the container's `/palworld`. Copy your real save's
*files* into the `WorldGUID` folder the server generated in step 2 — do **not**
create a new folder named after your own save's original `WorldGUID`; the server
won't use it (see the warning above).

Using the admin SSH key (see `scripts/deploy.sh` / `.env.example`'s `ADMIN_SSH_*`
fields), from a machine with the source save available:

```
scp -i <admin-key> -r "<local-path-to-your-save's-WorldGUID-folder>" \
  <ADMIN_SSH_USER>@<GAME_VM_HOST>:/tmp/world-import

ssh -i <admin-key> <ADMIN_SSH_USER>@<GAME_VM_HOST> '
  sudo rm -rf /mnt/palworld-data/Pal/Saved/SaveGames/0/<GENERATED_WORLDGUID_FROM_STEP_2>
  sudo mv /tmp/world-import /mnt/palworld-data/Pal/Saved/SaveGames/0/<GENERATED_WORLDGUID_FROM_STEP_2>
  sudo chown -R 1000:1000 /mnt/palworld-data/Pal/Saved/SaveGames/0/<GENERATED_WORLDGUID_FROM_STEP_2>
'
```

The `chown` to `1000:1000` matters — it must match `docker/compose.yml`'s
`PUID`/`PGID`, or the container won't have permission to read/write the save.

## 4. Verify

1. Start the server again (`/server start` in Discord or `palworld-ctl start`
   directly) — you don't need to redeploy, just start it.
2. Check the container logs for the world loading without errors:
   `docker compose -f /opt/palworld/docker-compose.yml logs -f`.
3. Compare `Level.sav`'s file size against your source save — a fresh/empty world's
   `Level.sav` is only a few KB; a real, played world is typically several MB. A
   mismatch here means the swap in step 3 didn't actually take.
4. Have one of the players who was in the original save connect and confirm their
   base/character/progress is actually there — file size matching and a clean
   server start with no errors are good evidence, but neither *proves* the right
   world loaded on their own.

## If something looks wrong

Don't delete anything — move the suspect folder aside (`mv ... .bak`) rather than
removing it, and see `docs/runbooks/world-restore.md` for restoring from a backup
once Phase 3's `backup.sh` exists.
