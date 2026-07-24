# discord-bot

TypeScript + discord.js v14 bot. See `CLAUDE.md` at the repo root for the overall
architecture; this file covers running and deploying just this piece.

## Local development

```
npm install
npm run dev
```

Config is loaded from the repo root's `.env.local` (not a separate `discord-bot/.env`
— single source of truth, shared with Terraform and `scripts/deploy.sh`). Copy
`.env.example` to `.env.local` at the repo root and fill in real values first.

Only the `DISCORD_*` fields are required for the bot to start — `GAME_VM_HOST`,
`RCON_*`, etc. can stay blank until the game VM exists; services that need them
validate at the point of use, not at boot.

## Scripts

- `npm run dev` — run directly from TypeScript source (`tsx`), for local iteration.
- `npm run build` — compile to `dist/`.
- `npm start` — run the compiled output (what the Docker image does).
- `npm run lint` / `npm run typecheck` / `npm test` — same checks CI runs.

## Deployment

Built via the multi-stage `Dockerfile` (compile stage, then a slim runtime image with
only production dependencies) and deployed to the bot VM's own `docker compose`
setup (`docker-compose.yml` in this directory) — separate from the game VM entirely,
so the bot stays reachable even when the Palworld container is fully stopped (see
`CLAUDE.md`'s architecture decisions).

- **Image publishing** (`.github/workflows/bot-cd.yml`'s `publish` job) is automatic:
  every merge to `main` touching `discord-bot/**` re-verifies (lint/typecheck/test/
  build) then pushes `ghcr.io/nathanfant/palworld-infrastructure/discord-bot` tagged
  with both the commit SHA and `latest`.
- **First-time / credential-rotation deploys** use `scripts/deploy-bot.sh`, run
  manually — it's the one place the live Discord bot token and the game VM's SSH
  private key get shipped to the bot VM, deliberately kept out of GitHub Actions
  entirely (see `CLAUDE.md`'s stance on the live bot token staying a human-approved
  action).
- **Subsequent rollouts** (after `deploy-bot.sh` has run once) use the same
  workflow's `deploy` job, triggered manually via `workflow_dispatch` ("Run
  workflow" in the Actions UI) — never automatically on merge. It only needs SSH
  access (repo Variables `BOT_VM_HOST`/`BOT_VM_SSH_USER`, and Secret
  `BOT_VM_SSH_PRIVATE_KEY`) to pull the new image and recreate the container; it
  never touches the bot's own secrets.
