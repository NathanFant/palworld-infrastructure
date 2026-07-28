# Dedicated, least-privileged credential for backup.sh/restore.sh once they run on a
# non-Oracle VM (Contabo -- see docs/decisions/006-migrate-to-contabo.md) and can no
# longer use backup-iam.tf's instance-principal auth, which only works for a caller
# that's genuinely an Oracle Cloud instance.
#
# A Customer Secret Key (the only auth type that works against Object Storage's
# S3-compatible endpoint from outside Oracle) is NOT independently scoped the way
# instance-principal is -- it inherits the full permissions of whatever OCI user it
# belongs to. Generating one for the same admin/Terraform user used everywhere else
# in this repo would mean a Contabo VM compromise leaks full tenancy access, not just
# backup-bucket access -- unacceptable given the same reasoning backup-iam.tf's own
# comment already lays out for the Oracle deployment.
#
# Fix: a dedicated user that exists for no other purpose, in its own group, with a
# policy scoped to exactly the backup bucket -- functionally the same scoping
# backup-iam.tf's dynamic-group achieves for instance-principal, just via OCI's
# user/group mechanism instead, since dynamic-groups only match instance identities.
resource "oci_identity_user" "backup_service" {
  compartment_id = var.tenancy_ocid # users are always created at the tenancy (root) level
  name           = "palworld-backup-service"
  description    = "Dedicated service account for the Contabo game VM's backup.sh/restore.sh Customer Secret Key. No other purpose -- do not add to any other group or policy."
  email          = var.backup_service_email
}

resource "oci_identity_group" "backup_service" {
  compartment_id = var.tenancy_ocid
  name           = "palworld-backup-service-group"
  description    = "Membership-only group for scoping palworld-backup-service's policy. No other members."
}

resource "oci_identity_user_group_membership" "backup_service" {
  user_id  = oci_identity_user.backup_service.id
  group_id = oci_identity_group.backup_service.id
}

resource "oci_identity_policy" "backup_service_access" {
  compartment_id = var.compartment_ocid
  name           = "palworld-backup-service-policy"
  description    = "Lets the dedicated backup-service user (via Customer Secret Key, used by backup.sh/restore.sh on the Contabo VM) manage objects in the backup bucket only -- nothing else in the tenancy."
  statements = [
    "Allow group ${oci_identity_group.backup_service.name} to manage objects in compartment id ${var.compartment_ocid} where target.bucket.name = '${var.backup_bucket_name}'"
  ]
}

# The secret value is only ever returned in the create response -- Terraform state
# is what retains it (same tradeoff every other real secret in this repo's tfvars/
# state already carries; nothing new). Rotate by tainting/recreating this resource.
resource "oci_identity_customer_secret_key" "backup_service" {
  user_id      = oci_identity_user.backup_service.id
  display_name = "palworld-backup-service-key"
}
