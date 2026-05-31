# ohffs

> **Work in progress.**

ohffs is a Model Context Protocol server for GitHub. Create and manage GitHub issues and projects using Claude.ai and your IDE — then push them as matching branches straight into your repo via Claude Code.

## NAS backup hook

This repo includes a `pre-push` git hook ([.githooks/pre-push](.githooks/pre-push)) that backs up the files changed in the most recent commit to a remote server (e.g. a NAS) over SSH before each push. Failed transfers are queued and retried on the next push.

### Requirements

- `sshpass`, `ssh`, and `scp` available on your `PATH`.
- The backup target must accept **password-based** SSH (keyboard-interactive); public-key auth is explicitly disabled in the hook.

### Setup

1. **Enable the hook directory** so git runs the hook:

   ```bash
   git config core.hooksPath .githooks
   ```

2. **Create a `.env`** in the repo root with your backup target. It is git-ignored, so your credentials are never committed:

   ```bash
   BACKUP_USER=youruser
   BACKUP_SERVER=nas.local          # hostname or IP
   BACKUP_PATH=/volume1/backups/ohffs
   BACKUP_PASSWORD=yourpassword
   BACKUP_PORT=22                   # optional, defaults to 22
   ```

   All four of `BACKUP_USER`, `BACKUP_SERVER`, `BACKUP_PATH`, and `BACKUP_PASSWORD` are required. If `.env` is missing or incomplete the hook skips the backup with a warning rather than blocking the push.

### Behaviour

- On each push, files changed in `HEAD` are copied to `BACKUP_PATH` on the server, preserving their repo-relative paths.
- If the server is unreachable or a file fails to transfer, it is added to a retry queue (`logs/.backup-queue`) and flushed on the next successful push.
- Activity is logged to `logs/.pre-push.log`. Both `logs/` and `.env` are git-ignored.
