# 001 — Why Oracle Cloud

## Decision

Host on Oracle Cloud Infrastructure, primarily on the Always Free tier: a single Ampere A1.Flex instance (2 OCPU,
within the free allowance / 32GB, exceeding it by design — see the 2026-07-24 and 2026-07-27 updates below),
provisioned via Terraform, running both the Palworld game server and the Discord bot
as separate Docker containers. (Originally provisioned as two instances — a second `VM.Standard.E2.1.Micro` for the
bot — until Oracle capacity for that shape proved unavailable for days; see
[`005-consolidate-bot-onto-game-vm.md`](005-consolidate-bot-onto-game-vm.md) for why one VM replaced two.)

## Alternatives considered

- **AWS / GCP free tiers** — both offer only small burstable instances (e.g. `t2.micro`/`e2-micro` class, ~1GB RAM)
  under their free tiers. Palworld's dedicated server needs several GB of RAM per the game's own recommended specs
  even for a 3-person world; neither free tier is viable without paying.
- **A rented game-hosting provider** (e.g. Nodecraft, Shockbyte-style Palworld hosts) — would work with zero infra
  effort, but costs real money monthly and gives no infrastructure-as-code, no SSH access to demonstrate the
  least-privilege control pattern, and nothing to build a portfolio around.
- **Self-hosting on a home PC/laptop** — free and simple, but ties server uptime to a home network's stability and
  power, and (raised and rejected explicitly during planning) would need a dedicated wired connection to be
  reliable, which wasn't available without buying more hardware — at which point it no longer saves money over
  a proper free-tier cloud VM.
- **Oracle Cloud paid shapes** — more headroom, but defeats the "near-zero hosting cost" project goal for a
  3-person friend server that doesn't need it.

## Reasoning / tradeoffs

Oracle's Always Free tier is the only major cloud offering with an instance shape (Ampere A1.Flex) that's both
free indefinitely and large enough to actually run Palworld's dedicated server comfortably. The tradeoff is real
and was accepted knowingly: Always Free *capacity* for popular shapes (especially Ampere A1) is genuinely scarce
and can take anywhere from minutes to days to become available for a new tenancy (see
[`docs/runbooks/capacity-retry.md`](../runbooks/capacity-retry.md)) — this is an operational cost paid once at
provisioning time, not an ongoing one, and was judged worth it against the alternative of paying monthly or
depending on home-network reliability.

A second, portfolio-specific reason: OCI's Terraform provider, IAM model (dynamic groups / instance principals),
and Always Free constraints (single-AD availability for free shapes, security-list/NSG modeling) are all genuine,
demonstrable infrastructure-as-code and cloud-security patterns worth documenting — not just "get a VM running."

## Update (2026-07-24) — Oracle halved the Always Free A1 allowance

Investigated as issue #63, after noticing this repo's Terraform defaults (`game_vm_ocpus = 4`, `game_vm_memory_gb =
24`) no longer matched Oracle's current documentation.

**What changed:** Oracle reduced the Always Free Ampere A1 Compute allowance from 4 OCPUs/24GB to 2 OCPUs/12GB
(1,500 OCPU hours + 9,000 GB hours/month), effective June 15, 2026. Oracle made no blog post, changelog entry, or
customer notification — the change was only visible as a documentation diff, and many users first learned about it
when existing instances were shut down. [Oracle's own Always Free Resources
docs](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) state plainly
that "all tenancies get the first 1,500 OCPU hours and 9,000 GB hours per month for free... equivalent to 2 OCPUs
and 12 GB of memory" for Always Free tenancies — no account-type carve-out is documented.

**Remaining ambiguity:** multiple independent reports (see sources below) describe Oracle support agents telling
some pay-as-you-go-upgraded accounts via email that they retain the old 4 OCPU/24GB allowance at no cost, which
directly contradicts the "all tenancies" wording in the documentation itself. Oracle has not published anything
reconciling this. This project's tenancy was created fresh specifically for this project (see this ADR's original
"nothing set up yet" starting point) with no PAYG upgrade, so it should be treated as subject to the new 2
OCPU/12GB limit unless verified otherwise in the OCI console (Governance -> Limits, Quotas and Usage -> Compute).

**Decision:** lowered `game_vm_ocpus`/`game_vm_memory_gb` defaults to 2/12 (`infrastructure/terraform/variables.tf`)
and added a `validation` block as a guardrail against accidentally requesting more than a typical Always Free
tenancy now gets — a soft 1-4 OCPU / 1-24GB sanity range rather than a hard 2/12 cap, since a legitimately
higher-limit tenancy (per the PAYG ambiguity above) is a real, if unconfirmed, possibility and shouldn't be blocked
outright. Overriding either variable is documented as requiring the operator to actually check their own tenancy's
limit first, not guess. (As of the 2026-07-27 update below, `game_vm_memory_gb`'s range serves a second, distinct
purpose too — see there.)

**Is 2 OCPU/12GB still enough for this project?** Genuinely uncertain, not a confirmed "yes" — worth stating
precisely rather than overclaiming. Pocketpair's own official requirements
([docs.palworldgame.com](https://docs.palworldgame.com/getting-started/requirements/)) recommend **4+ CPU cores**
and **16GB RAM** (32GB for larger setups), with 8GB noted as bootable but crash-prone from out-of-memory. The new
Always Free allowance (2 OCPU/12GB) is *below* Pocketpair's own recommended minimum on both axes — this is not the
same claim as "still comfortably sufficient." Separately, community benchmarks (not Pocketpair's own guidance)
report that Palworld's simulation model is heavily single/dual-thread-bound (per-Pal/per-base logic tends to land
on one or two cores rather than spreading across all available ones), which is why some hosts report real CPU
*usage* rarely exceeding ~2 cores in practice for small worlds — but that's an empirical usage pattern from
third-party sources, not a Pocketpair-endorsed substitute for their stated 4-core recommendation, and shouldn't be
read as one. On RAM, 12GB sits above the 8GB crash-prone floor and below the 16GB recommendation, for a group of 3
(smaller than the setups that guidance targets) — a reasonable bet, but still under Pocketpair's own number. No
sizing change was made to `docker/compose.yml` or the Palworld container's own config. Given this, the real
verification is empirical: `docs/runbooks/post-allocation-checklist.md` already calls for actually running the
server with real players once the game VM exists — that's the point this assumption gets tested for real, not this
document.

**One open question worth flagging:** this repo's `docs/runbooks/capacity-retry.md` has, up to this point,
attributed every failed `terraform apply` on `oci_core_instance.game` to true regional Ampere A1 capacity
exhaustion. Some community reports describe Oracle occasionally surfacing a limit-exceeded condition through the
same generic `500-InternalError, Out of host capacity` message rather than a distinct quota error — meaning it's
possible (not confirmed) that at least some of this project's own repeated capacity-retry failures were actually
this tenancy rejecting a request for more OCPUs/memory than it's currently allowed, not a lack of physical host
capacity. Retrying `scripts/retry-apply.ps1` now that the default has been corrected to 2 OCPU/12GB is a cheap way
to find out — if it succeeds promptly, sizing was very likely at least part of the problem; if the same error
persists, it's genuine capacity scarcity as originally assumed.

Sources: [InfoQ](https://www.infoq.com/news/2026/07/oracle-cloud-free-tier-limits/),
[Oracle Always Free Resources docs](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm),
[linuxiac.com](https://linuxiac.com/oracle-quietly-cuts-free-tier-ampere-a1-resources-in-half/).

## Update (2026-07-27) — 12GB wasn't enough; bumped memory to 32GB (a small, deliberate paid excess)

The previous update's open question — "is 2 OCPU/12GB still enough for this project?" — is no longer uncertain.
`docs/runbooks/post-allocation-checklist.md`'s own verification step (actually running the server with real
players) answered it empirically: the deployed server was repeatedly OOM-killed under real gameplay, with a fresh
restart alone (before any player even reconnected) already using ~11GB RAM. 12GB was under real, not just
Pocketpair-recommended, requirements for this world.

**Decision (PR #74, issue #73):** raised `game_vm_memory_gb`'s default and validation ceiling from 12/24 to 32/64.
OCPUs stay at 2 (still fully within the free allowance) — CPU was never the bottleneck, and A1.Flex allows up to
64GB of memory per OCPU, so no OCPU increase was needed to support more RAM. The 20GB above the 12GB free allowance
is billed at OCI's on-demand A1.Flex rate (~$0.0015/GB-hr), roughly **$22/month** — a small, deliberate, ongoing
cost, not a one-off.

This changes what `game_vm_memory_gb`'s validation range means, worth stating plainly: for OCPUs, the 1-4 range
documented above is still purely an anti-accident guardrail (nothing currently justifies exceeding the free
allowance there). For memory, the range now does double duty — still a guardrail against a wildly-wrong fat-finger
value (e.g. accidentally requesting 64GB), but the 12→32 portion specifically is no longer "stay within the free
tier by default," it's "this project's actual, tested memory requirement, which happens to cost a small amount
because Oracle's free allowance shrank out from under it." Cheaper alternatives (a smaller memory bump, or hosting
elsewhere entirely) were considered and explicitly rejected in favor of staying on Oracle at this size — see the
cost/alternatives discussion in issue #73 and PR #74 for the full comparison.
