data "oci_identity_availability_domains" "ads" {
  compartment_id = var.compartment_ocid
}

data "oci_core_images" "ubuntu_arm" {
  compartment_id           = var.compartment_ocid
  operating_system         = "Canonical Ubuntu"
  operating_system_version = "22.04"
  shape                    = "VM.Standard.A1.Flex"
  sort_by                  = "TIMECREATED"
  sort_order               = "DESC"
}

# No rules attached -- RCON no longer needs network-level scoping at all now that the
# Discord bot runs as a second container on this same VM and reaches it over loopback
# (see docs/decisions/005-consolidate-bot-onto-game-vm.md). Kept as an attachment
# point on the instance's VNIC for any future NSG-level rules.
resource "oci_core_network_security_group" "game" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.main.id
  display_name   = "palworld-game-nsg"
}

resource "oci_core_volume" "world_data" {
  compartment_id      = var.compartment_ocid
  availability_domain = data.oci_identity_availability_domains.ads.availability_domains[var.availability_domain_index].name
  display_name        = "palworld-world-data"
  size_in_gbs         = var.game_volume_size_gb
}

resource "oci_core_instance" "game" {
  compartment_id      = var.compartment_ocid
  availability_domain = data.oci_identity_availability_domains.ads.availability_domains[var.availability_domain_index].name
  display_name        = "palworld-game-vm"
  shape               = "VM.Standard.A1.Flex"

  shape_config {
    ocpus         = var.game_vm_ocpus
    memory_in_gbs = var.game_vm_memory_gb
  }

  source_details {
    source_type = "image"
    source_id   = data.oci_core_images.ubuntu_arm.images[0].id
  }

  create_vnic_details {
    subnet_id              = oci_core_subnet.public.id
    nsg_ids                = [oci_core_network_security_group.game.id]
    assign_public_ip       = true
    skip_source_dest_check = false
  }

  is_pv_encryption_in_transit_enabled = true

  metadata = {
    ssh_authorized_keys = var.admin_ssh_public_key
    user_data = base64encode(templatefile("${path.module}/../cloud-init/game-vm.yaml", {
      palworld_bot_ssh_public_key = var.palworld_bot_ssh_public_key
    }))
  }
}

# Explicit device path so it matches cloud-init's hardcoded /dev/oracleoci/oraclevdb
# assumption (documented in infrastructure/cloud-init/README.md) rather than relying
# on default device assignment landing on vdb.
resource "oci_core_volume_attachment" "world_data" {
  attachment_type = "paravirtualized"
  instance_id     = oci_core_instance.game.id
  volume_id       = oci_core_volume.world_data.id
  device          = "/dev/oracleoci/oraclevdb"
}
