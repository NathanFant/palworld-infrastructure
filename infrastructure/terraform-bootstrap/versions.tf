terraform {
  required_version = ">= 1.7.0"

  required_providers {
    oci = {
      source  = "oracle/oci"
      version = ">= 5.30, < 6.0"
    }
  }

  # Deliberately local state — this config creates the bucket that the root module's
  # remote state lives in, so it can't depend on that bucket existing yet. Applied by
  # hand, once, per CLAUDE.md's IaC decision. The resulting local terraform.tfstate
  # contains a sensitive secret key value (see outputs.tf) — never commit it, and
  # treat it as a one-time-use credential envelope, not a file to keep around.
}
