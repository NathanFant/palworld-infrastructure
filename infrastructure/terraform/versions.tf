terraform {
  required_version = ">= 1.7.0"

  required_providers {
    oci = {
      source  = "oracle/oci"
      version = ">= 5.30, < 6.0"
    }
  }

  # Partial backend config — real values (bucket/namespace/region/endpoint) are supplied
  # at `terraform init` time via `-backend-config=backend.hcl` (see backend.hcl.example).
  # This keeps no environment-specific values, and no secrets, in version control.
  backend "s3" {}
}
