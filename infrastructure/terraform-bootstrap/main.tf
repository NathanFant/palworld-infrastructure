data "oci_objectstorage_namespace" "ns" {
  compartment_id = var.compartment_ocid
}

resource "oci_objectstorage_bucket" "tfstate" {
  compartment_id = var.compartment_ocid
  namespace      = data.oci_objectstorage_namespace.ns.namespace
  name           = var.state_bucket_name
  access_type    = "NoPublicAccess"
  versioning     = "Enabled"
}

# S3-compatible credential for Terraform's `s3` backend to authenticate against Object
# Storage. This is distinct from the tenancy/user OCID + API-key auth the `oci`
# provider itself uses (see provider.tf) — the backend speaks the S3 API, not OCI's
# native API, so it needs its own credential type.
resource "oci_identity_customer_secret_key" "tfstate_backend" {
  display_name = "${var.state_bucket_name}-backend-key"
  user_id      = var.user_ocid
}
