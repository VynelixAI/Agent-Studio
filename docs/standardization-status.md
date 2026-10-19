# Agent Studio Standardization Status

**Review date:** 19 October 2026  
**Scope:** Focused standardization and security-hardening pass on the existing architecture. This status is not a production certification.

## Implemented in this pass

- Restored the complete Apache License 2.0 text.
- Added EditorConfig and Prettier configuration, an ESLint flat configuration, and quality-check CI.
- Fixed the catalog validation browser shim to define `window` without assigning an incompatible `Window` type.
- Added a high-confidence working-tree secret scan and a Gitleaks history scan in CI.
- Added Dependabot updates for root/server npm dependencies, the workflow runner's Python requirements, and GitHub Actions.
- Defaulted the API to loopback binding and restricted remote API configuration to production mode, valid API keys, a strong persistent secrets key, explicit CORS origins, and the Docker workflow runner.
- Added bounded child-process execution, output limits, timeout handling, environment-variable allow-listing, and Python virtual-environment selection.
- Added a Docker runner image and resource controls (read-only container root, no default network, dropped capabilities, no-new-privileges, CPU, memory, PID, and file-descriptor limits).
- Hardened workspace/node/secret-reference checks and run-artifact path validation.
- Restricted Unix permissions for run directories and decrypted secret files where supported.
- Preserved notebook failures as failed workflow runs rather than false successes.
- Added regression tests, a deployment/recovery guide, and a CI workflow that attempts builds, tests, dependency audits, Python checks, license inventories, and desktop compilation on Linux, Windows, and macOS.

## Checks run in this environment

| Check | Result |
|---|---|
| Focused regression tests for configuration, identifiers, artifact paths, and process runner | **20 passed, 0 failed** in the isolated Node test harness. The config tests used temporary stubs for unavailable application dependencies. |
| TypeScript/TSX syntax transpilation | **134 files transpiled; no syntax diagnostics.** This is not a typecheck. |
| Python test-source compilation | Passed via `python -m compileall -q testing server/tests`. |
| Repository JSON configuration validation | Passed for the inspected JSON files. |
| GitHub Actions / Docker Compose YAML parse | Passed for the inspected workflow and Compose YAML. |
| High-confidence secret scan of current working tree | Passed. Git history was not available in the ZIP; CI runs Gitleaks after the repository is pushed. |
| Python command resolver smoke test | Passed. |

## Checks not completed here

The environment could not reach the npm registry (`EAI_AGAIN`) and has no Docker or Rust/Cargo toolchain. Because of that, a complete `npm ci`, frontend build, backend TypeScript typecheck/build, full API/frontend test suites, npm/pip vulnerability audits, container build/smoke test, license inventory generation, and packaged Tauri smoke tests could not be executed locally. TypeScript syntax transpilation does not prove types are correct, and the CI workflow must be run successfully before release.

The formatter configuration and CI formatter check are present, but a full formatter pass has not been verified in this environment. Treat formatter results as a release gate, not as completed validation.

## Required release gates

1. On a network-enabled runner, install root and server dependencies from lockfiles and pass the full CI workflow.
2. Promote ESLint/Prettier packages from the CI's temporary tool install into reviewed manifests and lockfiles; run a full format pass and resolve lint failures.
3. Build and smoke-test the Docker runner, including Windows Docker Desktop path/ACL handling and the required connector providers.
4. Verify the restrictive Tauri CSP against Monaco, local API requests, UI assets, and packaged builds on Windows/macOS/Linux.
5. Complete tenant-scoped authorization, per-user quotas, execution cancellation and child-process tree termination validation, data-retention cleanup tests, and a backup/restore drill.
6. For remote/untrusted workflows, do not rely on Docker alone as a complete tenant sandbox: the run directory is mounted and contains that run's decrypted secrets. Implement per-tenant isolation and a secret broker or equivalent access controls before exposing it to untrusted multi-user traffic. Restrict egress if connectors require network access.
7. Review generated third-party dependency license inventories and vulnerability reports, verify all bundled assets' licenses, and scan complete Git history for secrets.

## Local development

By default the server binds to `127.0.0.1` and uses the host Python runtime only for trusted local workflows. For local execution, create `server/.venv` and install `server/sandbox/requirements.txt`. For any non-loopback API bind, configure production mode, authentication, a strong persistent `SECRETS_KEY`, valid API keys, explicit CORS origins, and the Docker runner. Do not use placeholder credentials or expose the service to untrusted users until all release gates have passed.
