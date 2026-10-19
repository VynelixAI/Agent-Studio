# Agent Studio workflow runner image

This image is used when `RUNNER_SANDBOX=docker`. It provides the standard Python
workflow dependencies and is run with a read-only container root, no Linux
capabilities, `no-new-privileges`, bounded memory/CPU/PIDs, and no network by default.

Build it from the repository root:

```bash
docker build -f server/sandbox/Dockerfile -t agent-studio-runner:local server/sandbox
```

Remote API deployments must set `RUNNER_SANDBOX=docker`; the API refuses to start
with a non-loopback bind when host-process execution is selected. Configure a
restricted Docker network through `RUNNER_DOCKER_NETWORK` only when workflows need
network access. Do not attach this runner to an unrestricted network for arbitrary
untrusted workflows; apply network-level egress rules and block cloud metadata/internal
control endpoints. A Docker container is a defense-in-depth boundary, not a guarantee
against kernel/container-runtime vulnerabilities.

The runner image has standard runtime dependencies baked in. If a workflow needs an
additional Python package, add it to this Dockerfile deliberately, rebuild the image,
and pin/review the dependency; runtime code is not permitted to install packages.
