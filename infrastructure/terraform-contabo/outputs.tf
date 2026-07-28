output "game_vm_public_ip" {
  value = contabo_instance.game.ip_config[0].v4[0].ip
}

output "game_vm_id" {
  value = contabo_instance.game.id
}
