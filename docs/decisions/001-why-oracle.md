# 001 — Why Oracle Cloud

## Decision

Host on Oracle Cloud Infrastructure's Always Free tier: an Ampere A1.Flex instance (4 OCPU / 24GB, ARM) for the
game server and a VM.Standard.E2.1.Micro instance (AMD) for the Discord bot, both provisioned via Terraform.

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
