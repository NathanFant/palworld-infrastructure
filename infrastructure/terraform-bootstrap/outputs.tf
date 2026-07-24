output "state_bucket_name" {
  value = oci_objectstorage_bucket.tfstate.name
}

output "namespace" {
  value = data.oci_objectstorage_namespace.ns.namespace
}

output "backend_access_key" {
  description = "Set as AWS_ACCESS_KEY_ID when running `terraform init` in infrastructure/terraform."
  value       = oci_identity_customer_secret_key.tfstate_backend.id
  sensitive   = true
}

output "backend_secret_key" {
  description = "Set as AWS_SECRET_ACCESS_KEY when running `terraform init` in infrastructure/terraform. Only ever shown once — save it (e.g. into .env.local and/or GitHub Actions secrets) immediately after apply."
  value       = oci_identity_customer_secret_key.tfstate_backend.key
  sensitive   = true
}
