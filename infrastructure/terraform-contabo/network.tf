# Contabo's contabo_firewall resource (instance-attached allow-rules, the closest
# equivalent to OCI's security list) requires a paid "firewall add-on" product on the
# instance -- confirmed the hard way: applying it against a real, already-created
# instance without that add-on fails with a 402 Payment Required. Rather than pay for
# an add-on just to get allow-list filtering, packet filtering is done host-side
# instead, via ufw configured in cloud-init (see
# infrastructure/cloud-init/game-vm-contabo.yaml's runcmd) -- same effect (SSH scoped
# to admin_ssh_cidr, game/query UDP ports open, everything else denied), no extra
# cost. RCON is intentionally not opened anywhere at all, exactly as on the Oracle
# deployment: docker/compose.yml publishes it to 127.0.0.1 only, and the Discord bot
# runs as a second container on this same VM reaching it over loopback (see
# docs/decisions/005-consolidate-bot-onto-game-vm.md, unchanged by this migration).
