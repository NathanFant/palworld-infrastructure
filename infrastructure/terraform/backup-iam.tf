# Lets the game VM upload backups to Object Storage without ever holding a static
# credential. A Customer Secret Key (the S3-compatible credential type used
# elsewhere in this repo for Terraform's own remote state) isn't an option here:
# those keys aren't independently scoped, they inherit the *full* permissions of
# whichever user they belong to. Putting that on a public-facing VM (open SSH,
# open game port) would mean a VM compromise leaks full account access, not just
# backup-bucket access. Instance Principal auth avoids this entirely: the VM
# authenticates as itself via its identity metadata, scoped down to exactly one
# bucket by the policy below.
resource "oci_identity_dynamic_group" "game_vm" {
  compartment_id = var.compartment_ocid
  name           = "palworld-game-vm"
  description    = "Matches the game VM instance specifically, for instance-principal auth to the backup bucket."
  matching_rule  = "ANY {instance.id = '${oci_core_instance.game.id}'}"
}

resource "oci_identity_policy" "game_vm_backup_access" {
  compartment_id = var.compartment_ocid
  name           = "palworld-game-vm-backup-policy"
  description    = "Lets the game VM (instance principal) manage objects in the backup bucket only -- nothing else in the tenancy."
  statements = [
    "Allow dynamic-group ${oci_identity_dynamic_group.game_vm.name} to manage objects in compartment id ${var.compartment_ocid} where target.bucket.name = '${var.backup_bucket_name}'"
  ]
}
