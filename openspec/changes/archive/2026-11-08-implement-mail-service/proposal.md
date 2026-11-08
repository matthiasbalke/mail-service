# Proposal

## Why

The repository needs a small, reusable SMTP mail service with environment-based configuration and secure transport support. Establishing tests, container packaging, and automated publishing makes it ready for future integration while its entry point sends an environment-configured email repeatedly.

## What Changes

- Implement a Bun and TypeScript application using a Node.js framework, with a reusable SMTP sender and optional SMTP username/password authentication.
- Support concurrent promise-based submissions through a reusable SMTP connection pool with bounded pending work and backpressure, ready for future high-throughput callers.
- Configure named pools using `SMTP_PROFILES`, `SMTP_DEFAULT_PROFILE`, and `SMTP_<PROFILE>_*` variables; select a pool per submission or through `MAIL_SMTP_PROFILE` for the recurring loop.
- Allow per-message sender address/display-name overrides without changing shared pool defaults.
- Configure SMTP through environment variables, supporting mandatory STARTTLS and implicit TLS (commonly called SSL).
- Provide one main function that runs an endless asynchronous loop, waiting 20 seconds before each call to the implemented mail-sending function, with no CLI, HTTP server, or web interface.
- Configure the recurring message with `MAIL_TO`, `MAIL_SUBJECT`, and `MAIL_TEXT`, and the sender with `SMTP_<PROFILE>_FROM` and optional `SMTP_<PROFILE>_FROM_NAME`.
- Log configuration, authentication, connection, TLS, and mail-sending errors through a logger framework at error level to the console only; never write application log files.
- Add isolated unit tests and GitHub Actions checks for tests, type checking, and builds.
- Build and publish a small Linux image to ghcr.io, running as an unprivileged user.
- Add Docker and Docker Compose usage and configuration examples to `docs/examples.md`; keep `readme.md` to a few sentences explaining the purpose.

## Capabilities

### New Capabilities

- `smtp-mail`: Environment-configured SMTP delivery, authentication, secure transport, concurrent pooled submissions, backpressure, and caller-visible outcomes.
- `application-runtime`: Bun application with a Node.js framework and a recurring mail-sending main entry point.
- `container-distribution`: Minimal non-root container, automated validation and GHCR publishing, and deployment examples.

### Modified Capabilities

None. The repository has no existing capability specifications or application implementation.

## Impact

Adds application source, Bun package metadata and lockfile, unit tests, Docker packaging, GitHub Actions workflows, and documentation. Proposed dependencies are NestJS for the application framework and Nodemailer for SMTP delivery. No existing APIs or runtime behavior need migration.
