# terraform-bootstrap

One-time setup that creates the Object Storage bucket + S3-compatible credential the
main Terraform config (`infrastructure/terraform`) uses for remote state. This is a
chicken-and-egg problem — the state bucket can't be created by config that stores its
own state in that same bucket — so it's a separate, small, **locally-stated** config,
applied by hand, once (or again only if the state bucket itself needs to be recreated).

## Usage

1. Have an OCI account with an API signing key set up (tenancy/user OCID, fingerprint,
   private key, region — see the repo root `.env.example`).
2. `cp terraform.tfvars.example terraform.tfvars` and fill in real values.
3. `terraform init && terraform apply`
4. Immediately capture the sensitive outputs:
   ```
   terraform output -raw backend_access_key
   terraform output -raw backend_secret_key
   ```
   Save these as `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` in `.env.local` (for
   local Terraform runs) and as GitHub Actions secrets (for CI's Terraform plan step).
5. In `infrastructure/terraform`, `cp backend.hcl.example backend.hcl`, fill in the
   `endpoint` using the `namespace` output from this config, then:
   ```
   terraform init -backend-config=backend.hcl
   ```

## After this runs

- `terraform.tfstate` in this directory now contains the secret key value in plain
  text. Don't commit it (already gitignored), and treat it as sensitive at rest —
  once the secrets are captured in step 4, this local state file's only remaining
  purpose is letting you `terraform destroy`/recreate this bootstrap config later.
- This bootstrap config is intentionally never touched by CI — it's a manual,
  human-run step, consistent with CLAUDE.md's "real cloud account actions stay
  human-approved" rule.
