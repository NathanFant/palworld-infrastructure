# Contabo's own OAuth2-based auth -- entirely separate credential from the sibling
# infrastructure/terraform directory's OCI API key (that one only authenticates the
# `oci` provider and this project's Oracle-hosted Terraform state backend, both of
# which stay in place; see versions.tf).
provider "contabo" {
  oauth2_client_id     = var.contabo_oauth2_client_id
  oauth2_client_secret = var.contabo_oauth2_client_secret
  oauth2_user          = var.contabo_oauth2_user
  oauth2_pass          = var.contabo_oauth2_pass
}
