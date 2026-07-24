variable "tenancy_ocid" {
  description = "OCID of the OCI tenancy (root compartment)."
  type        = string
}

variable "user_ocid" {
  description = "OCID of the OCI user Terraform authenticates as."
  type        = string
}

variable "fingerprint" {
  description = "Fingerprint of the uploaded API signing key, from the OCI console."
  type        = string
}

variable "private_key_path" {
  description = "Path to the private half of the API signing key. Never commit this file."
  type        = string
}

variable "region" {
  description = "OCI region, e.g. us-ashburn-1."
  type        = string
}

variable "compartment_ocid" {
  description = "Compartment OCID resources are created in. The tenancy's root compartment is fine for a project this size."
  type        = string
}

# --- Networking ---

variable "vcn_cidr" {
  description = "CIDR block for the VCN."
  type        = string
  default     = "10.0.0.0/16"
}

variable "subnet_cidr" {
  description = "CIDR block for the single public subnet both VMs live in."
  type        = string
  default     = "10.0.1.0/24"
}

variable "admin_ssh_cidr" {
  description = "CIDR allowed to SSH into either VM (port 22). No default — must be set explicitly to your own IP/32, never left open to 0.0.0.0/0."
  type        = string
}

variable "admin_ssh_public_key" {
  description = "Public half of a dedicated admin keypair, injected into both VMs' default-user authorized_keys via instance metadata. Separate from the OCI API key (Terraform/provider auth) and the bot's forced-command-restricted key (infrastructure/cloud-init) — this one gets a real shell. Only read by cloud-init at first boot: changing this and re-applying against an already-launched instance has no effect until it's destroyed and recreated."
  type        = string
}

variable "palworld_port" {
  description = "UDP port the Palworld dedicated server listens on, open to the public internet."
  type        = number
  default     = 8211
}

variable "rcon_port" {
  description = "TCP port Palworld's RCON listens on. Restricted to the subnet CIDR, not the public internet — see network.tf for why a subnet-wide restriction is used instead of a single-host /32."
  type        = number
  default     = 25575
}

# --- Backups (Object Storage) ---
# Retention windows mirror the tiers documented in the README (hourly: 24, daily: 7,
# weekly: 4, monthly: 6), translated to day-based expiry since Object Storage
# lifecycle policies expire by object age + name prefix, not by keeping a fixed count.
# backup.sh (a later, separate ticket) is expected to write objects under the matching
# prefix (e.g. "daily/palworld-<timestamp>.tar.gz").

variable "backup_bucket_name" {
  description = "Object Storage bucket name for world-save backups. Matches .env.example's OCI_BACKUP_BUCKET_NAME."
  type        = string
  default     = "palworld-backups"
}

variable "backup_retention_hourly_days" {
  description = "Expire objects under hourly/ after this many days (24 hourly backups ~= 1 day)."
  type        = number
  default     = 1
}

variable "backup_retention_daily_days" {
  description = "Expire objects under daily/ after this many days."
  type        = number
  default     = 7
}

variable "backup_retention_weekly_days" {
  description = "Expire objects under weekly/ after this many days (4 weeks)."
  type        = number
  default     = 28
}

variable "backup_retention_monthly_days" {
  description = "Expire objects under monthly/ after this many days (6 months)."
  type        = number
  default     = 180
}

# --- Compute (shared) ---

variable "availability_domain_index" {
  description = <<-EOT
    Index into data.oci_identity_availability_domains.ads.availability_domains for both
    VMs. Always Free shapes (both E2.1.Micro and A1.Flex) are only available in ONE
    specific availability domain per tenancy in multi-AD regions — NOT necessarily
    index 0. Find yours via the OCI console: Governance -> Limits, Quotas and Usage ->
    Compute -> cycle the Availability Domain dropdown until VM.Standard.A1.Flex /
    VM.Standard.E2.1.Micro show a non-zero limit.
  EOT
  type        = number
  default     = 0
}

# --- Game VM ---

variable "game_vm_ocpus" {
  description = "OCPUs for the Ampere A1 game VM. Default is the full Always Free A1 allowance."
  type        = number
  default     = 4
}

variable "game_vm_memory_gb" {
  description = "Memory (GB) for the Ampere A1 game VM. Default is the full Always Free A1 allowance."
  type        = number
  default     = 24
}

variable "game_volume_size_gb" {
  description = "Size of the Block Volume holding the Palworld world save, separate from the boot volume."
  type        = number
  default     = 100
}

variable "palworld_bot_ssh_public_key" {
  description = "Public half of the dedicated keypair generated for the bot's restricted SSH access (see infrastructure/cloud-init/README.md). Injected into game-vm.yaml's authorized_keys forced-command line via templatefile()."
  type        = string
}
