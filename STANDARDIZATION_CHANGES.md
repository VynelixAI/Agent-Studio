# Agent Studio — Standardization Changes

Reviewed and updated: 19 October 2026

This is a focused hardening pass over the existing codebase. It intentionally preserves the existing product architecture and workflow formats rather than performing a risky rewrite.

## Changes applied
- Fixed the catalog validation script's browser shim: it defines `window` through `Object.defineProperty` rather than assigning `globalThis` to a value typed as `Window`, and dynamically imports catalog modules only after the test globals exist.

### Security and configuration
- API binds to `127.0.0.1` by default; network exposure now requires explicit configuration.
- Remote production startup fails when authentication keys or a strong, non-placeholder secret-encryption key are missing.
- API CORS origins default to a finite allow-list rather than `*`.
- Once API keys are configured, invalid or missing credentials no longer fall back to the implicit local administrator principal.
- Unscrubbed run logs and outputs require the `admin` role.
- Secret references and user-provided identifiers are validated before persistence or use as map keys; workflow node IDs and workflow structure are validated before materialization.
- Secrets and run/code-lab files are written with restrictive Unix permissions where supported.
- Database connection URIs are no longer logged by the API startup path.
- Tauri receives a restrictive CSP, and the inline theme bootstrap was moved to a module file.
- Desktop installs create a persistent per-user encryption key even before first-run setup has generated the YAML config.

### Execution and reliability
- Added a shared child-process runner with bounded output capture and a timeout.
- Python lookup prefers the repository-managed virtual environment. Child processes receive only essential OS environment variables by default; connector variables must be explicitly allow-listed with `RUNNER_ENV_ALLOWLIST`, while core backend credentials are never passed through.
- Notebook execution errors remain failed runs rather than being reported as success.
- Workflow execution no longer attempts to install PyYAML into the host Python on every run or use `--break-system-packages`.
- Added validation and process-runner regression tests.

### Repository hygiene
- Added `.editorconfig`, `.prettierrc.json`, and `.prettierignore`.
- Added a CI quality workflow for dependency installation, type checks/builds, API tests, stage tests, and Python syntax checks.
- Documented safe local and remote environment configuration.

## Validation performed in this environment

- Validated repository JSON configuration files.
- Transpiled 128 TypeScript/TSX source files with the globally available TypeScript compiler API; no syntax diagnostics were reported.
- Ran 13 focused Node tests for identifier/secret-reference validation and bounded process execution; all passed.
- Ran the offline workflow-domain suite: 90 tests run, 0 failures, 0 errors, 3 skipped because optional dependencies or live external services were unavailable.
- Ran 5 generated stage-dataset tests; all passed.
- Compiled Python test sources with `python -m compileall`; passed.
- Parsed repository JSON configuration files; all validated successfully.
- Transpiled 131 TypeScript/TSX files with the globally available TypeScript compiler API; no syntax diagnostics were reported.

## Limitations — do not interpret this as production certification

- A complete dependency-backed TypeScript typecheck, npm build, frontend tests, complete API test suite, and packaged Tauri smoke test were not run. Installing dependencies timed out while reaching the npm registry in this environment. The successful TypeScript transpilation above checks syntax only; it is not a full typecheck.
- The CSP has not yet been verified against a packaged Tauri application; validate Monaco, frontend assets, API calls, and the intended connector/provider integrations on Windows, macOS, and Linux.
- Arbitrary workflow/code-lab code is still executed with the server user's OS permissions. Timeouts and input validation are not a sandbox. Remote multi-user deployment must add process/container isolation, resource limits, per-user authorization and quotas before accepting untrusted workflows.
- The product should provision and maintain a dedicated Python virtual environment with the required workflow dependencies during setup. Runtime execution no longer mutates the machine-wide Python installation.
- The codebase still has large modules that should be refactored incrementally after tests cover their behavior. Do not split them purely to meet a line-count target.
- Configure a real lint tool and formatter in dependency manifests/lockfiles, then run them in CI. The existing `lint` script is currently a TypeScript check, not ESLint.
- Restored missing CSV fixtures used by the offline workflow-domain tests so the packaged test suite can run reproducibly without external databases.
- Validate API input schemas, run cancellation/child-process tree termination, data-retention cleanup, and backup/restore flows before release.

## Recommended next sequence

1. Establish Python-runtime setup and workflow sandboxing.
2. Run `npm ci` at the repository root and `npm ci --prefix server` in a network-enabled environment.
3. Run root build, server build, all server tests, Python workflow tests, and desktop build/smoke tests.
4. Add an actual linter, run formatter across changed files, and make the full quality suite a required CI check.
5. Refactor oversized files by responsibility, with regression tests and one small pull request per subsystem.

## Follow-up archive verification

- After the catalog-validation shim correction, transpiled 131 TypeScript/TSX files with the globally available TypeScript compiler API: no syntax diagnostics.
- Parsed all 10 repository JSON configuration files successfully.
- Python source compilation completed successfully for `testing` and `server/tests`.
- A dependency-backed TypeScript typecheck/build was not run because project dependencies are not installed in this working environment.
- The stage-dataset unittest suite skipped because its generated Python fixture was not present in this clean archive. The offline workflow-domain suite could not start because `testing/_generated/code/run_workflow.py` must first be generated by the normal npm/tsx workflow. Run the repository CI workflow after installing dependencies to verify those suites end to end.
