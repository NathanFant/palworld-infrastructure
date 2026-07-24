# Single VCN, single public subnet — both VMs are always-on and need inbound access
# (SSH for admins, the game port for players, RCON for the bot), so there's no
# meaningful isolation win from splitting public/private subnets for a 2-host, 3-player
# project. See CLAUDE.md for why both VMs stay always-on rather than being stopped.

resource "oci_core_vcn" "main" {
  compartment_id = var.compartment_ocid
  cidr_block     = var.vcn_cidr
  display_name   = "palworld-vcn"
  dns_label      = "palworldvcn"
}

resource "oci_core_internet_gateway" "main" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.main.id
  display_name   = "palworld-igw"
  enabled        = true
}

resource "oci_core_route_table" "public" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.main.id
  display_name   = "palworld-public-rt"

  route_rules {
    destination       = "0.0.0.0/0"
    destination_type  = "CIDR_BLOCK"
    network_entity_id = oci_core_internet_gateway.main.id
  }
}

# RCON is intentionally NOT in this security list — it's scoped at the instance level
# via a cross-NSG rule in compute-bot.tf (oci_core_network_security_group_security_rule),
# restricting it to traffic from the bot VM's NSG specifically, not the whole subnet.
# This replaced an earlier subnet-CIDR-based rule once the bot VM (and its NSG) existed
# to reference — see the review discussion on issues #9/#10.
resource "oci_core_security_list" "main" {
  compartment_id = var.compartment_ocid
  vcn_id         = oci_core_vcn.main.id
  display_name   = "palworld-security-list"

  ingress_security_rules {
    protocol    = "6" # TCP
    source      = var.admin_ssh_cidr
    description = "SSH (admin access only)"

    tcp_options {
      min = 22
      max = 22
    }
  }

  ingress_security_rules {
    protocol    = "17" # UDP
    source      = "0.0.0.0/0"
    description = "Palworld dedicated server (public, players connect here)"

    udp_options {
      min = var.palworld_port
      max = var.palworld_port
    }
  }

  egress_security_rules {
    protocol    = "all"
    destination = "0.0.0.0/0"
    description = "Unrestricted egress (package installs, Discord gateway, Docker Hub, etc.)"
  }
}

resource "oci_core_subnet" "public" {
  compartment_id             = var.compartment_ocid
  vcn_id                     = oci_core_vcn.main.id
  cidr_block                 = var.subnet_cidr
  display_name               = "palworld-public-subnet"
  dns_label                  = "palworldpub"
  route_table_id             = oci_core_route_table.public.id
  security_list_ids          = [oci_core_security_list.main.id]
  prohibit_public_ip_on_vnic = false
}
