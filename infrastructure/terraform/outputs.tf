output "vcn_id" {
  value = oci_core_vcn.main.id
}

output "public_subnet_id" {
  description = "Consumed by the game-VM Terraform ticket to place the instance."
  value       = oci_core_subnet.public.id
}

output "security_list_id" {
  value = oci_core_security_list.main.id
}

output "backup_bucket_name" {
  value = oci_objectstorage_bucket.backups.name
}

output "backup_namespace" {
  description = "Consumed by backup.sh (later ticket) to construct the Object Storage upload target."
  value       = data.oci_objectstorage_namespace.ns.namespace
}

output "game_vm_public_ip" {
  value = oci_core_instance.game.public_ip
}

output "game_vm_private_ip" {
  description = "Reserved for anything on the VCN needing the game VM's private address; not currently consumed by anything (the Discord bot runs on this same VM now and reaches it via 127.0.0.1)."
  value       = oci_core_instance.game.private_ip
}

output "game_nsg_id" {
  value = oci_core_network_security_group.game.id
}

# Feeds infrastructure/terraform-contabo's oracle_backup_access_key/
# oracle_backup_secret_key variables -- see backup-service-account.tf. Marked
# sensitive so a plain `terraform output` doesn't print it; use `terraform output
# -raw backup_service_secret_key` to actually retrieve it.
output "backup_service_access_key" {
  value = oci_identity_customer_secret_key.backup_service.id
}

output "backup_service_secret_key" {
  value     = oci_identity_customer_secret_key.backup_service.key
  sensitive = true
}
