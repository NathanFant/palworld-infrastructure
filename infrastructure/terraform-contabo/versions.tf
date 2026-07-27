terraform {
  required_version = ">= 1.12.0"

  required_providers {
    contabo = {
      source  = "contabo/contabo"
      version = ">= 0.1, < 1.0"
    }
  }

  # Deliberately the SAME Oracle Object Storage bucket infrastructure/terraform's own
  # state lives in -- state stays on Oracle even though compute moves to Contabo (see
  # docs/decisions/006-migrate-to-contabo.md). Just a different `key` (state file
  # path) in that bucket, supplied via `terraform init -backend-config=backend.hcl`,
  # same as the sibling directory.
  backend "oci" {}
}
