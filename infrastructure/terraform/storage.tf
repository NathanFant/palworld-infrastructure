data "oci_objectstorage_namespace" "ns" {
  compartment_id = var.compartment_ocid
}

# Required for object_lifecycle_policy to actually function — OCI's lifecycle engine
# runs as the region-qualified "objectstorage-<region>" service principal (Object
# Storage is regional, so each region used needs its own grant), which needs its own
# explicit IAM authorization to expire/delete objects on your behalf, separate from
# your own user's permissions. Without this, lifecycle policy operation fails with
# InsufficientServicePermissions. Per Oracle's docs, this must be scoped to a
# compartment (not "in tenancy"), created in the root compartment.
resource "oci_identity_policy" "objectstorage_lifecycle" {
  compartment_id = var.compartment_ocid
  name           = "palworld-objectstorage-lifecycle"
  description    = "Allows the Object Storage service to execute this project's backup-retention lifecycle rules."
  statements     = ["Allow service objectstorage-${var.region} to manage object-family in compartment id ${var.compartment_ocid}"]
}

# IAM policy changes aren't instantly visible to every OCI service — without an
# explicit ordering + delay, oci_objectstorage_object_lifecycle_policy below can fire
# before the Object Storage service principal's grant above has actually propagated,
# failing with InsufficientServicePermissions even though the policy exists (a known
# OCI IAM eventual-consistency gotcha, confirmed by a real failed apply during
# development — Terraform had no reason to sequence these since neither referenced
# the other's attributes).
resource "time_sleep" "wait_for_objectstorage_policy" {
  depends_on      = [oci_identity_policy.objectstorage_lifecycle]
  create_duration = "30s"
}

resource "oci_objectstorage_bucket" "backups" {
  compartment_id = var.compartment_ocid
  namespace      = data.oci_objectstorage_namespace.ns.namespace
  name           = var.backup_bucket_name
  access_type    = "NoPublicAccess"
  # No versioning: backups are distinct timestamped objects that are never overwritten,
  # so there's nothing for versioning to protect against — it would only add storage
  # cost. Retention is handled entirely by the lifecycle policy below.
  versioning = "Disabled"
}

# Age + prefix based expiry — Object Storage lifecycle rules can't do "keep the last N
# objects" directly, so each retention tier from the README (hourly/daily/weekly/
# monthly) is translated into "expire objects under <tier>/ older than <N> days".
# backup.sh (a later ticket) is expected to write objects under the matching prefix,
# e.g. "daily/palworld-<timestamp>.tar.gz".
resource "oci_objectstorage_object_lifecycle_policy" "backups" {
  depends_on = [time_sleep.wait_for_objectstorage_policy]
  namespace  = data.oci_objectstorage_namespace.ns.namespace
  bucket     = oci_objectstorage_bucket.backups.name

  rules {
    name        = "expire-hourly"
    action      = "DELETE"
    time_amount = var.backup_retention_hourly_days
    time_unit   = "DAYS"
    is_enabled  = true
    target      = "objects"

    object_name_filter {
      inclusion_prefixes = ["hourly/"]
    }
  }

  rules {
    name        = "expire-daily"
    action      = "DELETE"
    time_amount = var.backup_retention_daily_days
    time_unit   = "DAYS"
    is_enabled  = true
    target      = "objects"

    object_name_filter {
      inclusion_prefixes = ["daily/"]
    }
  }

  rules {
    name        = "expire-weekly"
    action      = "DELETE"
    time_amount = var.backup_retention_weekly_days
    time_unit   = "DAYS"
    is_enabled  = true
    target      = "objects"

    object_name_filter {
      inclusion_prefixes = ["weekly/"]
    }
  }

  rules {
    name        = "expire-monthly"
    action      = "DELETE"
    time_amount = var.backup_retention_monthly_days
    time_unit   = "DAYS"
    is_enabled  = true
    target      = "objects"

    object_name_filter {
      inclusion_prefixes = ["monthly/"]
    }
  }
}
