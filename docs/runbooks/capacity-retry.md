# Runbook: Oracle Cloud "Out of host capacity" during apply

## Symptom

`terraform apply` in `infrastructure/terraform` fails on `oci_core_instance.game` and/or
`oci_core_instance.bot` with one of:

- `500-InternalError, Out of host capacity.` (typically the Ampere A1 game VM)
- `404-NotAuthorizedOrNotFound, Authorization failed or requested resource not found.`
  when it's actually the AMD E2.1.Micro bot VM failing — Oracle labels this shape's
  capacity exhaustion misleadingly as an auth error rather than a clear capacity error.
  This is a known, widely-reported quirk specific to `VM.Standard.E2.1.Micro`, not a
  real permissions problem, **provided** you've already confirmed (see below) that
  `admin_ssh_cidr`, `availability_domain_index`, and IAM policies are all correct.

## Cause

Always Free tier capacity for both shapes is genuinely scarce and shared across all
Oracle customers in a region/availability domain. This is not a bug in this repo's
Terraform — it's Oracle not having free spare capacity available right now.

## How to tell this apart from a real config bug

Before assuming it's just capacity:
- Confirm `availability_domain_index` in `terraform.tfvars` points at the AD your
  tenancy actually has Always Free entitlement in (OCI console: **Governance ->
  Limits, Quotas and Usage -> Compute**, cycle the AD dropdown, look for a non-zero
  limit for `VM.Standard.A1.Flex` / `VM.Standard.E2.1.Micro`).
- Confirm `terraform plan` shows only the expected resources with no unexpected
  diffs.

If those check out and you're still seeing the errors above, it's capacity.

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
