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
