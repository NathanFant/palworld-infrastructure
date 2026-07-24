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
