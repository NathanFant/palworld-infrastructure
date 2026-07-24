output "vcn_id" {
  value = oci_core_vcn.main.id
}

output "public_subnet_id" {
  description = "Consumed by the game-VM and bot-VM Terraform tickets to place instances."
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
