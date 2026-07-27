# Contabo's ssh_keys argument on the instance takes a list of secret IDs, not raw key
# strings -- the public key has to be uploaded as its own resource first.
resource "contabo_secret" "admin_ssh_key" {
  name  = "palworld-admin-key"
  type  = "ssh"
  value = var.admin_ssh_public_key
}

resource "contabo_instance" "game" {
  display_name = "palworld-game-vm"
  product_id   = var.product_id
  region       = var.region
  image_id     = var.image_id
  default_user = "admin"
  period       = 1 # month-to-month -- no long-term commitment while Contabo is still being proven out

  ssh_keys = [contabo_secret.admin_ssh_key.id]

  # No separate block-volume resource/concept exists for this instance type -- unlike
  # OCI, Contabo bundles storage into the instance itself (see
  # docs/decisions/006-migrate-to-contabo.md). World-save data lives in a plain
  # directory on the main disk (see game-vm-contabo.yaml), not a mounted device.
  user_data = templatefile("${path.module}/../cloud-init/game-vm-contabo.yaml", {
    palworld_bot_ssh_public_key = var.palworld_bot_ssh_public_key
    oracle_backup_namespace     = var.oracle_backup_namespace
    oracle_backup_bucket_name   = var.oracle_backup_bucket_name
    oracle_backup_region        = var.oracle_backup_region
    oracle_backup_access_key    = var.oracle_backup_access_key
    oracle_backup_secret_key    = var.oracle_backup_secret_key
  })
}
