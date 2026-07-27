# 005 — Consolidate the Discord bot onto the game VM

## Decision

Run the Discord bot as a second Docker container on the same Ampere A1 game VM, instead of provisioning a separate
`VM.Standard.E2.1.Micro` "bot VM." The bot authenticates over SSH to `127.0.0.1` as the same restricted
`palworld-bot` forced-command principal it always would have used against a second host — only the network hop
changed (loopback instead of crossing the VCN), not the security mechanism itself.

## Context that forced this decision

The original architecture (see [`001-why-oracle.md`](001-why-oracle.md)) assumed two Always Free instances: an
Ampere A1.Flex game VM and an AMD `VM.Standard.E2.1.Micro` bot VM — the latter chosen because it was free
*in addition to* the A1 allowance, not carved out of it. The bot VM sat unprovisioned for days despite the game VM
launching successfully. A temporary, read-only Terraform data source query against this tenancy's actual OCI
service limits (removed after use, not committed) confirmed this wasn't a config bug: the tenancy genuinely has
free quota for 2 `E2.1.Micro` instances in the correct availability domain, and the Terraform config was already
pointed at that AD correctly. It's real, if indefinite, regional capacity scarcity for that specific shape — the
same quirk `docs/runbooks/capacity-retry.md` already documented (Oracle surfaces it as a misleading
`404-NotAuthorizedOrNotFound` rather than a clear capacity error).

The same limits query showed 250 free Ampere A1 cores available in every AD — clearly not the bottleneck. That
made "give the bot a slice of the A1 budget instead" tempting, but OCI's A1.Flex shape only allows whole-number
OCPU allocation (no fractional 0.5, confirmed against Oracle's own compute-shapes documentation) — splitting the
existing 2 OCPU/12GB Always Free A1 budget between two instances would mean 1 OCPU each, a real cut to the game
server's already-reduced allowance (see [`001-why-oracle.md`'s 2026-07-24 update](001-why-oracle.md)), not a clean
half-and-half split.

## Alternatives considered

- **Split the free A1 budget 1 OCPU/1 OCPU between two A1.Flex instances** — stays $0/month and uses capacity
  already proven available, but takes the game server from 2 OCPU down to 1 OCPU to free up a whole core for a
  process that barely needs one. Rejected: the game server's CPU headroom was already a documented concern at 2
  OCPU; cutting it further for the bot's sake wasn't a good trade when the bot doesn't need a dedicated core at all.
- **Pay for a small standalone A1.Flex slice for the bot** (e.g. 1 OCPU/2GB) — leaves the game VM's free allocation
  untouched, and A1 capacity is confirmed available. Rejected: real ongoing cost (~$8-9/month at OCI's PAYG list
  price) for a problem that has a genuinely free solution once you notice the bot doesn't need its own host at all.
- **Keep waiting on the free `E2.1.Micro` shape** — no architecture change, stays $0/month. Rejected as the
  ongoing default: the wait is real regional scarcity with no predictable resolution time, and there was no reason
  to keep waiting once a same-cost, immediately-available alternative existed.
- **Host the bot outside Oracle entirely** (a different provider, or the user's own hardware) — would also solve
  the capacity problem, but breaks the single-VCN, single-provider architecture this repo documents throughout,
  adds a second thing to secure and maintain, and solves nothing the in-Oracle consolidation doesn't already solve
  for free. Rejected as a bigger change for no additional benefit.
- **Mount the Docker socket into the bot container for local `docker compose` exec**, removing the SSH layer
  entirely — simpler in principle (one less network hop, no forced-command mechanism to reason about), but hands
  the bot container root-equivalent access to the host (a well-known container-escape risk). Rejected: this repo's
  whole security narrative around `palworld-ctl` is a least-privilege demonstration worth keeping intact; trading
  it away just to save one SSH call the code already handles for free isn't worth it.

## Reasoning / tradeoffs

This works cleanly because of something already true in this codebase: only the Palworld *container* is ever
started or stopped — never the VM itself (see [`004-discord-triggering.md`](004-discord-triggering.md)) — so a bot
container living on the same host keeps running independently of the game container's state, exactly as it did
across two VMs. Nothing about the bot's actual job (voice presence, `/server` commands, status heartbeat, the 48h
lifecycle manager) ever required a second physical or virtual host; that was purely a byproduct of `E2.1.Micro`
being free capacity *on top of* the A1 budget when the architecture was first designed. Once that shape stopped
being reliably available, the "why not just co-locate it" question had no good counter-argument.

Concretely: the bot's Docker container runs with `network_mode: host` (its connections are 100% outbound — the
Discord gateway, SSH to `127.0.0.1`, RCON to `127.0.0.1` — so it never listens on anything; giving up bridge
network isolation costs nothing real here). `docker/compose.yml`'s RCON port publish tightened from `0.0.0.0` to
`127.0.0.1` only as a direct, free hardening win from consolidation: nothing outside this one host has ever needed
RCON access again, so nothing outside it can reach it now, versus a small subnet-scoped NSG rule doing the same
job less tightly before.

**Trade-off worth stating plainly, not glossed over:** with one VM, if the VM itself ever has a real problem
(not just the Palworld container being stopped, an actual host-level issue), both the bot and the game go down
together — previously, a live bot VM could still report "the game VM is unreachable" to Discord. In practice this
is a narrow edge case: Always Free Ampere A1 instances aren't observed to reboot unexpectedly in normal operation,
and Docker's `restart: unless-stopped` policy brings both containers back automatically after any reboot regardless
of cause. The everyday scenario the bot actually exists for — "the container is stopped, the VM is fine, tell me
and let me start it" — is completely unaffected by this change.
