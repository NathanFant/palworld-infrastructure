# Contabo's firewall model is instance-attached allow-rules, not a separate VCN/
# subnet/security-list hierarchy like OCI -- there's no equivalent networking
# primitive to provision here beyond this one resource. RCON is intentionally NOT in
# this firewall at all, exactly as on the Oracle deployment: docker/compose.yml
# publishes it to 127.0.0.1 only, and the Discord bot runs as a second container on
# this same VM reaching it over loopback (see
# docs/decisions/005-consolidate-bot-onto-game-vm.md, unchanged by this migration).

resource "contabo_firewall" "game" {
  name   = "palworld-game-firewall"
  status = "active"

  instance_ids = [contabo_instance.game.id]

  rules {
    inbound {
      protocol   = "tcp"
      action     = "accept"
      status     = "active"
      dest_ports = ["22"]

      src_cidr {
        ipv4 = [var.admin_ssh_cidr]
      }
    }

    inbound {
      protocol   = "udp"
      action     = "accept"
      status     = "active"
      dest_ports = [tostring(var.palworld_port)]

      src_cidr {
        ipv4 = ["0.0.0.0/0"]
      }
    }

    inbound {
      protocol   = "udp"
      action     = "accept"
      status     = "active"
      dest_ports = [tostring(var.palworld_query_port)]

      src_cidr {
        ipv4 = ["0.0.0.0/0"]
      }
    }
  }
}
