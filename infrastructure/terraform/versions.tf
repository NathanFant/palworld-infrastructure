terraform {
  # >= 1.12 for the native `oci` backend (added that version) — see backend.hcl.example
  # for why this replaced the earlier S3-compatible-endpoint approach.
  required_version = ">= 1.12.0"

  required_providers {
    oci = {
      source  = "oracle/oci"
      version = ">= 5.30, < 6.0"
    }
    time = {
      source  = "hashicorp/time"
      version = ">= 0.9, < 1.0"
    }
  }

  # Partial backend config — real values (bucket/namespace/tenancy/user/etc.) are
  # supplied at `terraform init` time via `-backend-config=backend.hcl` (see
  # backend.hcl.example). This keeps no environment-specific values, and no secrets,
  # in version control.
  backend "oci" {}
}
