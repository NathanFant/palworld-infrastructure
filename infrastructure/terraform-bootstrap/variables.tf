variable "tenancy_ocid" {
  description = "OCID of the OCI tenancy (root compartment)."
  type        = string
}

variable "user_ocid" {
  description = "OCID of the OCI user Terraform authenticates as, and the user the backend's Customer Secret Key is issued to."
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
  description = "Compartment OCID the state bucket is created in."
  type        = string
}

variable "state_bucket_name" {
  description = "Name of the Object Storage bucket that will hold Terraform remote state."
  type        = string
  default     = "palworld-tfstate"
}
