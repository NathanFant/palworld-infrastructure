# --- Contabo provider auth (see provider.tf) ---

variable "contabo_oauth2_client_id" {
  description = "OAuth2 client ID from Contabo's Customer Control Panel -> Account Security."
  type        = string
}

variable "contabo_oauth2_client_secret" {
  description = "OAuth2 client secret, same Customer Control Panel page as contabo_oauth2_client_id."
  type        = string
  sensitive   = true
}

variable "contabo_oauth2_user" {
  description = "Contabo account login email."
  type        = string
}

variable "contabo_oauth2_pass" {
  description = "Contabo API password -- a separate password set/changed in the Customer Control Panel's Account Security section, NOT the account login password."
  type        = string
  sensitive   = true
}

# --- Instance ---

variable "product_id" {
  description = "Contabo product/plan ID for the instance (the \"Cloud VPS 6\" plan -- 6 vCPU / 12GB RAM / 200GB SSD, as configured on Contabo's order page). Looked up via Contabo's API once credentials are available, not guessable from docs alone."
  type        = string
}

variable "region" {
  description = "Contabo region. \"US-central\" chosen for player latency (vs. the free default EU region) -- see docs/decisions/006-migrate-to-contabo.md."
  type        = string
  default     = "US-central"
}

variable "image_id" {
  description = "Contabo image ID for the instance OS -- a real UUID, not a simple alias string (Contabo's API has no products/images catalog endpoint to browse this from ahead of time; this default was confirmed against a real ordered instance). Ubuntu, matching the rest of this project's Docker-based tooling."
  type        = string
  default     = "d64d5c6c-9dda-4e38-8174-0ee282474d8a"
}

variable "admin_ssh_public_key" {
  description = "Public half of the admin keypair, uploaded as a Contabo secret and injected as the instance's initial SSH key. Same purpose as the sibling infrastructure/terraform directory's variable of the same name -- can be the same key or a fresh one, operator's choice."
  type        = string
}

variable "admin_ssh_cidr" {
  description = "CIDR allowed to SSH into the game VM (port 22) via the Contabo firewall. No default -- must be set explicitly, never left open to 0.0.0.0/0."
  type        = string
}

variable "palworld_bot_ssh_public_key" {
  description = "Public half of the dedicated keypair for the bot's forced-command-restricted SSH access. Same key material/purpose as the sibling infrastructure/terraform directory's variable of the same name."
  type        = string
}

variable "palworld_port" {
  description = "UDP port the Palworld dedicated server listens on, open to the public internet. Same default as the sibling infrastructure/terraform directory."
  type        = number
  default     = 8211
}

variable "palworld_query_port" {
  description = "UDP query port for Steam/community server list discovery. Same default as the sibling infrastructure/terraform directory."
  type        = number
  default     = 27015
}

variable "rcon_port" {
  description = "TCP port Palworld's RCON listens on. Not present in the firewall at all -- docker/compose.yml publishes it to 127.0.0.1 only, and the Discord bot runs as a second container on this same VM reaching it over loopback, exactly as on the Oracle deployment (see docs/decisions/005-consolidate-bot-onto-game-vm.md, unchanged by this migration)."
  type        = number
  default     = 25575
}

# --- Backups (Oracle Object Storage, unchanged by this migration -- see
# docs/decisions/006-migrate-to-contabo.md for why storage/state stay on Oracle) ---

variable "oracle_backup_namespace" {
  description = "Oracle Object Storage namespace the backup bucket lives in (same value as infrastructure/terraform's data.oci_objectstorage_namespace.ns output)."
  type        = string
}

variable "oracle_backup_bucket_name" {
  description = "Oracle Object Storage bucket name for world-save backups. Matches infrastructure/terraform's backup_bucket_name / .env.example's OCI_BACKUP_BUCKET_NAME."
  type        = string
  default     = "palworld-backups"
}

variable "oracle_backup_region" {
  description = "OCI region the backup bucket lives in, used to construct the S3-compatible endpoint URL (https://<namespace>.compat.objectstorage.<region>.oraclecloud.com)."
  type        = string
}

variable "oracle_backup_access_key" {
  description = "Access key half of an OCI Customer Secret Key (Identity -> Users -> your user -> Customer Secret Keys -> Generate Secret Key), scoped to this backup bucket. Replaces the Oracle-VM-only instance-principal auth mechanism, which cannot work once compute is no longer an Oracle instance."
  type        = string
  sensitive   = true
}

variable "oracle_backup_secret_key" {
  description = "Secret key half of the same OCI Customer Secret Key as oracle_backup_access_key. Shown only once at generation time in the OCI console -- save it then, it can't be retrieved again later."
  type        = string
  sensitive   = true
}
