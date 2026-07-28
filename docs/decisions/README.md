# Architecture Decision Records

Lightweight records of the tradeoffs behind this project's major infrastructure and process choices — not full
design docs, just enough to keep future changes from re-litigating decisions that were already made deliberately.

Each ADR follows the same shape: **Decision**, **Alternatives considered**, **Reasoning / tradeoffs**.

- [001 — Why Oracle Cloud](001-why-oracle.md)
- [002 — Why Docker for the Palworld server](002-why-docker.md)
- [003 — Backup strategy](003-backup-strategy.md)
- [004 — Discord-triggered lifecycle, not always-on](004-discord-triggering.md)
- [005 — Consolidate the Discord bot onto the game VM](005-consolidate-bot-onto-game-vm.md)
- [006 — Migrate the game server from Oracle (ARM64/box64) to Contabo (native x86)](006-migrate-to-contabo.md)
