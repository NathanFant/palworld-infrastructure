# Single VCN, single public subnet — the one VM is always-on and needs inbound access
# (SSH for admins, the game port for players), so there's no meaningful isolation win
# from splitting public/private subnets for a 1-host, 3-player project. See CLAUDE.md
# for why the VM stays always-on rather than being stopped. RCON needs no ingress rule
# at all: the Discord bot runs as a second container on this same host and reaches it
# over loopback (docker/compose.yml publishes RCON to 127.0.0.1 only), never crossing
# the VCN's network fabric.

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

# RCON is intentionally NOT in this security list at all — since the Discord bot was
# consolidated onto this same VM (issue #65), RCON is only ever reached over loopback
# (docker/compose.yml publishes it to 127.0.0.1 only), which never touches the VCN's
# network fabric or NSG/security-list filtering in the first place. Earlier revisions
# scoped this via a cross-NSG rule to a separate bot VM's NSG; see
# docs/decisions/005-consolidate-bot-onto-game-vm.md for why that's gone.
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

  ingress_security_rules {
    protocol    = "17" # UDP
    source      = "0.0.0.0/0"
    description = "Palworld community server list query port (COMMUNITY=true in docker/compose.yml)"

    udp_options {
      min = var.palworld_query_port
      max = var.palworld_query_port
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
