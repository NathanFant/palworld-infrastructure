# 001 — Why Oracle Cloud

## Decision

Host on Oracle Cloud Infrastructure's Always Free tier: an Ampere A1.Flex instance (2 OCPU / 12GB, ARM — see the
2026-07-24 update below) for the game server and a VM.Standard.E2.1.Micro instance (AMD) for the Discord bot, both
provisioned via Terraform.

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
limit first, not guess.

**Is 2 OCPU/12GB still enough for this project?** Yes, comfortably, for the 3-person target: Palworld's dedicated
server is documented (Pocketpair's own guidance) as using at most ~2 CPU cores under load regardless of how many
more are available, and needing 8GB as a workable-but-crash-prone floor for 4-6 players, 16GB as the general
recommendation. 12GB sits well above the crash-prone floor and only 4GB under the general recommendation, for a
group smaller than the 4-6-player range that floor targets. No sizing change to `docker/compose.yml` or the
Palworld container's own config was needed.

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
