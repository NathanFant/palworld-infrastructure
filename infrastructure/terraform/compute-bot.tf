data "oci_core_images" "ubuntu_amd" {
  compartment_id           = var.compartment_ocid
  operating_system         = "Canonical Ubuntu"
  operating_system_version = "22.04"
  shape                    = "VM.Standard.E2.1.Micro"
  sort_by                  = "TIMECREATED"
  sort_order               = "DESC"
}

resource "oci_core_network_security_group" "bot" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.main.id
  display_name   = "palworld-bot-nsg"
}

# Replaces network.tf's earlier subnet-CIDR-scoped RCON rule now that the bot VM's NSG
# exists to reference — true instance-level scoping: only traffic from VNICs that are
# members of the bot NSG (i.e. the bot VM itself) can reach RCON on the game VM.
resource "oci_core_network_security_group_security_rule" "rcon_from_bot" {
  network_security_group_id = oci_core_network_security_group.game.id
  direction                 = "INGRESS"
  protocol                  = "6" # TCP
  source_type               = "NETWORK_SECURITY_GROUP"
  source                    = oci_core_network_security_group.bot.id
  description               = "RCON — restricted to the bot VM specifically, not the whole subnet"

  tcp_options {
    destination_port_range {
      min = var.rcon_port
      max = var.rcon_port
    }
  }
}

resource "oci_core_instance" "bot" {
  compartment_id      = var.compartment_ocid
  availability_domain = data.oci_identity_availability_domains.ads.availability_domains[var.availability_domain_index].name
  display_name        = "palworld-bot-vm"
  shape               = "VM.Standard.E2.1.Micro"

  source_details {
    source_type = "image"
    source_id   = data.oci_core_images.ubuntu_amd.images[0].id
  }

  create_vnic_details {
    subnet_id              = oci_core_subnet.public.id
    nsg_ids                = [oci_core_network_security_group.bot.id]
    assign_public_ip       = true
    skip_source_dest_check = false
  }

  is_pv_encryption_in_transit_enabled = true

  metadata = {
    user_data = base64encode(file("${path.module}/../cloud-init/bot-vm.yaml"))
  }
}
