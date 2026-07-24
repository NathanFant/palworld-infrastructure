# Auth for the `oci` provider (manages real resources) is the OCI API signing key —
# NOT the same credential as the S3-compatible backend auth in versions.tf's backend
# block. Two different credential mechanisms, two different purposes:
#   - oci provider auth:  tenancy/user OCID + API signing key (this file)
#   - remote state auth:  S3-compatible "Customer Secret Key" (access/secret key pair,
#                          created by infrastructure/terraform-bootstrap, supplied via
#                          AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY env vars at init)
provider "oci" {
  tenancy_ocid     = var.tenancy_ocid
  user_ocid        = var.user_ocid
  fingerprint      = var.fingerprint
  private_key_path = var.private_key_path
  region           = var.region
}
