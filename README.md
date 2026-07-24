# Palworld Infrastructure

A cloud-hosted, Dockerized Palworld platform designed around operational simplicity, automated lifecycle management, and cost-efficient hosting.

This repository contains the infrastructure, configuration, automation, backup strategy, and operational documentation used to run a dedicated Palworld server for a small player group while minimizing administrative overhead and preventing offline world progression.

## Project Goals

- Run a dedicated Palworld server without requiring a host player to be online
- Automatically pause world progression when nobody is playing
- Maintain reliable and recoverable backups
- Keep hosting costs near zero
- Document operational procedures and disaster recovery workflows
- Demonstrate practical infrastructure, DevOps, and automation practices

---

## Features

### Infrastructure

- Dockerized deployment
- Cloud-hosted Linux VM
- Infrastructure-as-code driven configuration
- Environment-based configuration management
- Persistent world storage

### Operations

- Automated server startup and shutdown
- Discord-driven server management
- Voice-channel-triggered lifecycle automation
- Centralized operational documentation
- Repeatable deployment procedures

### Reliability

- Automated backups
- Backup retention policies
- Disaster recovery runbooks
- Server health monitoring
- World-save preservation

### Maintenance

- Version-controlled configuration
- Upgrade procedures
- World migration documentation
- Recovery testing
- Change history through Git

---

## Architecture

```text
Discord Voice Channel
          │
          ▼
     Discord Bot
          │
          ▼
   Lifecycle Controller
          │
          ▼
      Docker Host
          │
          ▼
 ┌─────────────────┐
 │ Palworld Server │
 └─────────────────┘
          │
          ▼
 Persistent Storage
          │
          ▼
 Automated Backups
```

---

## Operational Philosophy

The server is intentionally not designed to run 24/7.

When the server is offline:

- Pal hunger does not progress
- Breeding does not progress
- Incubation timers do not progress
- Resource production does not progress
- Raid events do not occur

The world only exists while players are actively using it.

This approach reduces hosting costs, simplifies management, and preserves the intended gameplay experience for a small private community.

---

## Repository Structure

```text
.
├── backups/
│   ├── backup.sh
│   ├── restore.sh
│   └── retention/
│
├── discord-bot/
│
├── docker/
│   ├── compose.yml
│   └── configs/
│
├── docs/
│   ├── architecture.md
│   ├── deployment.md
│   ├── disaster-recovery.md
│   ├── monitoring.md
│   └── runbooks/
│
├── scripts/
│
└── .github/
    └── workflows/
```

---

## Backup Strategy

Example retention policy:

- Hourly backups: 24
- Daily backups: 7
- Weekly backups: 4
- Monthly backups: 6

Backups should be stored separately from the running server whenever possible.

---

## Disaster Recovery

Recovery objectives:

- Restore server infrastructure
- Restore world save data
- Restore configuration
- Restore automation services

Target recovery time and procedures are documented in the runbooks directory.

---

## Future Enhancements

- Infrastructure provisioning with Terraform
- Automated deployment pipeline
- Monitoring dashboards
- Alerting and notification workflows
- Multi-environment support
- Automated recovery validation

---

## Why This Exists

This project serves two purposes:

1. Provide reliable game hosting for a small player community.
2. Demonstrate practical experience with infrastructure management, containerization, automation, backup strategy, operational documentation, and systems reliability.

While the workload is a game server, the concepts are broadly applicable to production systems and operational engineering.

See [`docs/decisions/`](docs/decisions/) for the reasoning behind the major infrastructure and process choices.

---

## License

Licensed under the MIT License.

You are free to use, modify, distribute, and build upon this project in accordance with the terms of the license.