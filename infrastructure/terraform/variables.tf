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
  description = "CIDR block for the single public subnet the game VM lives in."
  type        = string
  default     = "10.0.1.0/24"
}

variable "admin_ssh_cidr" {
  description = "CIDR allowed to SSH into the game VM (port 22). No default — must be set explicitly to your own IP/32, never left open to 0.0.0.0/0."
  type        = string
}

variable "admin_ssh_public_key" {
  description = "Public half of a dedicated admin keypair, injected into the game VM's default-user authorized_keys via instance metadata. Separate from the OCI API key (Terraform/provider auth) and the bot's forced-command-restricted key (infrastructure/cloud-init) — this one gets a real shell. Only read by cloud-init at first boot: changing this and re-applying against an already-launched instance has no effect until it's destroyed and recreated."
  type        = string
}

variable "palworld_port" {
  description = "UDP port the Palworld dedicated server listens on, open to the public internet."
  type        = number
  default     = 8211
}

variable "palworld_query_port" {
  description = "UDP query port used for Steam/community server list discovery (thijsvanloef/palworld-server-docker's QUERY_PORT). Only needed while COMMUNITY=true in docker/compose.yml; open to the public internet like palworld_port."
  type        = number
  default     = 27015
}

variable "rcon_port" {
  description = "TCP port Palworld's RCON listens on. Not present in the security list or any NSG rule at all -- docker/compose.yml publishes it to 127.0.0.1 only, since the Discord bot runs as a second container on this same VM and reaches it over loopback (see docs/decisions/005-consolidate-bot-onto-game-vm.md)."
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

variable "backup_service_email" {
  description = "Email address for the dedicated palworld-backup-service user (backup-service-account.tf) -- OCI's identity domain requires a primary email on user creation. A plus-addressed variant of your own email (e.g. you+palworld-backup@example.com) works fine and still lands in your inbox; this account has no login/console access, the email is just satisfying OCI's user-record schema."
  type        = string
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
    Index into data.oci_identity_availability_domains.ads.availability_domains for the
    game VM. The Always Free A1.Flex shape is only available in ONE specific
    availability domain per tenancy in multi-AD regions — NOT necessarily index 0.
    Find yours via the OCI console: Governance -> Limits, Quotas and Usage -> Compute
    -> cycle the Availability Domain dropdown until VM.Standard.A1.Flex shows a
    non-zero limit.
  EOT
  type        = number
  default     = 0
}

# --- Game VM ---

variable "game_vm_ocpus" {
  description = <<-EOT
    OCPUs for the Ampere A1 game VM. Default is the full Always Free A1 allowance as
    of Oracle's June 15, 2026 change (see docs/decisions/001-why-oracle.md's update
    note) -- previously 4. Oracle's own docs state the reduced allowance applies to
    "all tenancies," but some support responses have reportedly told PAYG-upgraded
    accounts they keep the old 4 OCPU allowance -- if you've explicitly confirmed a
    higher limit for your own tenancy (OCI console: Governance -> Limits, Quotas and
    Usage -> Compute -> VM.Standard.A1.Flex), override this and game_vm_memory_gb
    accordingly; don't just guess higher.
  EOT
  type        = number
  default     = 2

  validation {
    condition     = var.game_vm_ocpus >= 1 && var.game_vm_ocpus <= 4
    error_message = "game_vm_ocpus should be 1-4 -- above 2 exceeds the documented Always Free allowance unless you've confirmed your tenancy retains the old limit (see this variable's description)."
  }
}

variable "game_vm_memory_gb" {
  description = <<-EOT
    Memory (GB) for the Ampere A1 game VM. The Always Free A1 allowance as of
    Oracle's June 15, 2026 change is 12GB (see game_vm_ocpus's description for the
    same tenancy-specific-limit caveat) -- this defaults to 32, an intentional,
    billed excess over that allowance (~$22/month for the 20GB above free, at OCI's
    A1.Flex on-demand rate of $0.0015/GB-hr), because real gameplay on this world
    has repeatedly exceeded 12GB and triggered OOM kills. OCPUs stay within the free
    allowance (see game_vm_ocpus) -- this is a memory-only cost, and A1.Flex allows
    up to 64GB of memory per OCPU, so no OCPU increase is needed to support it.
  EOT
  type        = number
  default     = 32

  validation {
    condition     = var.game_vm_memory_gb >= 1 && var.game_vm_memory_gb <= 64
    error_message = "game_vm_memory_gb should be 1-64 -- above 12 exceeds the documented Always Free allowance and is billed (see this variable's description for the expected cost)."
  }
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
