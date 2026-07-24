# 004 — Discord-triggered lifecycle, not always-on

## Decision

Keep both VMs always on (they're free regardless of uptime), but only start/stop the Palworld Docker *container*
on the game VM — triggered by a Discord slash command (`/server start|stop|restart`) or observed manually via a
voice-channel presence watcher, rather than running the game process continuously or auto-starting it from voice
activity.

## Alternatives considered

- **Auto-start the server the moment someone joins the watched voice channel** — removes the need for a manual
  `/server start` entirely, but couples game-server lifecycle to voice presence in a way that's surprising
  (joining voice to talk about something unrelated would spin up the server) and removes the player's ability to
  decide when the world should progress.
- **Stop/start the game VM itself (OCI instance lifecycle), not just the container** — would save nothing, since
  Always Free shapes cost nothing whether running or stopped; it would only add OCI instance-lifecycle API calls
  and startup latency (full boot vs. container start) as fragile surface for zero benefit.
- **A web dashboard instead of Discord** — the friend group already coordinates entirely in Discord; a separate
  dashboard would be one more thing to host, secure, and check, for a control surface Discord's slash commands
  already provide natively (built-in auth via server roles, no separate login system to build).
- **Always run the server continuously** — simplest to implement, but directly conflicts with the project goal of
  preventing offline world progression (and associated resource/backup churn) when nobody's playing.

## Reasoning / tradeoffs

Voice presence is used for *visibility* ("who's currently playing"), not automation — the actual start/stop
decision stays an explicit, role-gated Discord command (`isAdmin()` in `discord-bot/src/commands/server.ts`),
so the group always has a person-in-the-loop for something as disruptive as restarting a shared world. The status
heartbeat and voice-presence embed exist specifically so that decision can be made with accurate live information
(is it already running, is anyone in voice) instead of guessing. The tradeoff is one extra manual step (typing
`/server start`) versus a fully automatic experience — accepted because it keeps server lifecycle predictable and
avoids the "why did the world start progressing, I was just in voice chatting" surprise case.
