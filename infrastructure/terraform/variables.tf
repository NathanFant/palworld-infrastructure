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
