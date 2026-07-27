# Runbook: Oracle Cloud "Out of host capacity" during apply

## Symptom

`terraform apply` in `infrastructure/terraform` fails on `oci_core_instance.game` with:

```
500-InternalError, Out of host capacity.
```

(This project only provisions one instance now — the Ampere A1 game VM, which also
runs the Discord bot as a second container. See
[`docs/decisions/005-consolidate-bot-onto-game-vm.md`](../decisions/005-consolidate-bot-onto-game-vm.md)
for why there's no longer a separate bot VM shape to troubleshoot here.)

## Cause

Always Free tier capacity for the Ampere A1 shape is genuinely scarce and shared
across all Oracle customers in a region/availability domain. This is not a bug in
this repo's Terraform — it's Oracle not having free spare capacity available right
now.

## How to tell this apart from a real config bug

Before assuming it's just capacity:
- Confirm `availability_domain_index` in `terraform.tfvars` points at the AD your
  tenancy actually has Always Free entitlement in (OCI console: **Governance ->
  Limits, Quotas and Usage -> Compute**, cycle the AD dropdown, look for a non-zero
  limit for `VM.Standard.A1.Flex`).
- Confirm `terraform plan` shows only the expected resources with no unexpected
  diffs.
- Confirm `game_vm_ocpus`/`game_vm_memory_gb` (`infrastructure/terraform/variables.tf`)
  don't request more than your tenancy is actually entitled to. Oracle halved the
  Always Free A1 allowance from 4 OCPU/24GB to 2 OCPU/12GB on June 15, 2026 (see
  [`docs/decisions/001-why-oracle.md`'s 2026-07-24 update](../decisions/001-why-oracle.md)
  for the full investigation) with no public announcement — a request that exceeds
  your tenancy's actual current limit is a real possibility worth ruling out, and
  some reports describe Oracle surfacing that as the same generic
  `Out of host capacity` error rather than a distinct quota error.

If those check out and you're still seeing the error above, it's capacity. A
temporary, read-only Terraform data source query against this tenancy's actual OCI
service limits (see `docs/decisions/005-consolidate-bot-onto-game-vm.md`'s context
section for how) is a reliable way to confirm your tenancy's real entitlement for a
given shape/AD combination if you want certainty rather than inference from the error
message alone.

## Fix

Run the retry loop and leave it running — it can take anywhere from minutes to hours
(occasionally longer) depending on regional demand:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/retry-apply.ps1
```

`-ExecutionPolicy Bypass` is required on a default Windows install (unsigned local
scripts are blocked otherwise); it only affects this one invocation, not the
system-wide policy.

Each attempt runs a fresh `terraform apply -auto-approve` (not a stale saved plan), so
it only ever tries to create whatever's still missing from state — already-created
resources (networking, storage, etc.) are left alone. Defaults to checking every 60s
for up to 500 attempts; override with `-IntervalSeconds` / `-MaxAttempts` -- e.g.
`-IntervalSeconds 120 -MaxAttempts 5000` for a much longer unattended run once it's
clear a single default 500-attempt pass (~8 hours) isn't going to be enough.

Once apply actually succeeds, continue with
[`post-allocation-checklist.md`](post-allocation-checklist.md) for what to do next.
