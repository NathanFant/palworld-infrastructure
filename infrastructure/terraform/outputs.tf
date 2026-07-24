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

output "game_vm_public_ip" {
  value = oci_core_instance.game.public_ip
}

output "game_vm_private_ip" {
  description = "Used by the bot VM's SSH/RCON client config to reach the game VM."
  value       = oci_core_instance.game.private_ip
}

output "game_nsg_id" {
  description = "Consumed by the bot-VM Terraform ticket to add the cross-NSG RCON ingress rule."
  value       = oci_core_network_security_group.game.id
}

output "bot_vm_public_ip" {
  value = oci_core_instance.bot.public_ip
}

output "bot_vm_private_ip" {
  value = oci_core_instance.bot.private_ip
}

output "bot_nsg_id" {
  value = oci_core_network_security_group.bot.id
}
