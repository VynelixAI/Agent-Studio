# Backup and restore guidance

This document describes a first-line operator procedure. Test it against a staging database before relying on it for disaster recovery.

## What must be backed up

1. MongoDB data for `MONGODB_DB` (workspaces, encrypted secrets, execution history, and audit data).
2. Run artifacts under `RUNS_ROOT` if you need output/log history. The default root is `data/runs` relative to the server deployment layout.
3. The persistent `SECRETS_KEY`, stored separately in a secrets manager or offline protected store. Without the original key, encrypted secrets in a MongoDB backup cannot be decrypted.
4. The deployment configuration with credentials removed, plus exact source/version and runner-image tag. Never package `.env` or decrypted `secrets.local.*` files in a shareable archive.

## Backup (PowerShell)

Run from a trusted administrative terminal where MongoDB Database Tools (`mongodump`) are installed. Set `MONGODB_URI` and `MONGODB_DB` in the environment first; avoid placing a credential-bearing URI directly in shared command history.

```powershell
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = Join-Path $PWD "agent-studio-backup-$stamp"
New-Item -ItemType Directory -Path $backup | Out-Null
mongodump --uri="$env:MONGODB_URI" --db="$env:MONGODB_DB" --out="$backup\mongo"
if ($LASTEXITCODE -ne 0) { throw 'MongoDB backup failed' }
$runRoot = if ($env:RUNS_ROOT) { $env:RUNS_ROOT } else { '..\..\data\runs' }
if (Test-Path $runRoot) { Copy-Item -Recurse -Force $runRoot (Join-Path $backup 'runs') }
Get-ChildItem $backup -Recurse -File | Get-FileHash -Algorithm SHA256 | Export-Csv (Join-Path $backup 'SHA256SUMS.csv') -NoTypeInformation
Write-Host "Backup created at $backup. Store the encryption key separately."
```

## Restore (staging first)

1. Stop Agent Studio API instances and prevent workflow executions.
2. Restore into an isolated/staging database first; verify the database name and backup date carefully.
3. Restore run artifacts into the configured runs root with restrictive filesystem permissions.
4. Restore the original `SECRETS_KEY` through the deployment secret manager; do not rotate it unless you deliberately re-encrypt all stored secrets.
5. Start the API on loopback, run health/API tests, verify workspace retrieval, decrypt a known test secret, and confirm representative workflow outputs.
6. Only after validation, point production to the restored state. Record who performed the restore and when.

Example staging restore command (replace the database and path deliberately):

```powershell
mongorestore --uri="$env:MONGODB_URI" --nsFrom="$env:BACKUP_DB.*" --nsTo="$env:MONGODB_DB.*" "$env:BACKUP_MONGO"
if ($LASTEXITCODE -ne 0) { throw 'MongoDB restore failed' }
```

Restore procedures depend on MongoDB topology, authentication, encryption configuration, and the environment's actual `RUNS_ROOT`. This guide is not a claim that disaster recovery has been exercised; run a timed restore drill before production release.
