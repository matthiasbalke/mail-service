# Implementation verification

Local checks completed on 2026-11-08:

- Frozen Bun dependency installation, type checking, and production build passed.
- Application tests: 94 unit and 7 integration tests passed, including verified TLS, certificate rejection, connection pooling, and shutdown.
- Promotion action: 10 policy tests passed, including execution from a copied action directory in an independent workspace, invalid inputs, access failures, missing sources, digest mismatch, conflicts, and no-op retries.
- Real disposable registry tests passed for byte-identical single-manifest and multi-platform index promotion, with platform and attestation descriptors retained.
- Full publication contract test passed against a disposable registry and local Git remote: candidate-only promotion rejected, required checks enforced, exact platform descriptors assembled, verified SHA retries preserved, stale runs skipped latest, lightweight and annotated release tags resolved, malformed versions and moved tags rejected.
- Five workflow contract tests passed; actionlint 1.7.12 and Bash syntax validation passed.
- Compose configuration passed using the committed environment example in an isolated temporary directory.
- Native local amd64 Docker build and runtime smoke passed: UID/GID 65532:65532, CA trust, actual STARTTLS delivery to a controlled fixture, and clean SIGTERM. Measured image size: 208195133 bytes (198.6 MiB).

The local machine is amd64. Synthetic arm64 descriptors verify registry behavior but do not execute arm64 application code. Native amd64 and arm64 builds and smoke tests, followed by GHCR publication, passed in GitHub Actions run https://github.com/matthiasbalke/mail-service/actions/runs/42492710161. The resulting combined image digest is `sha256:05c7dfd89e589d3d35f7ac6b1a86eb4e38434b194906d1aae685ad4977464f95`. No production release tag was created as a test. The user confirmed that promotion works and review is complete; the change is approved for sync and archive.
