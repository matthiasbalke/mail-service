# Tasks

## 1. Bun application foundation

- [x] 1.1 Add TypeScript package metadata, NestJS and Nodemailer dependencies, Bun lockfile, pinned Bun version, ignore rules, and typecheck/test/build/start scripts; verify frozen installation and type checking succeed.
- [x] 1.2 Add recurring-message configuration for required `MAIL_TO`, `MAIL_SUBJECT`, and `MAIL_TEXT`; verify unit tests cover nonblank values, comma-separated recipients, empty entries, and safe startup errors with nonzero exit.
- [x] 1.3 Configure production output for the entry point and reusable mail module; verify built output is runnable and the mail module is importable.
- [x] 1.4 Create `readme.md` containing two or three purpose-focused sentences; verify it describes SMTP sending and does not expand into setup documentation.

## 2. SMTP configuration and delivery

- [x] 2.1 Implement explicit environment parsing for host, sender address/display name (`SMTP_<PROFILE>_FROM` / `SMTP_<PROFILE>_FROM_NAME`), port, security mode, and optional credential pair; verify unit tests cover defaults, overrides, missing/empty required values, malformed/out-of-range ports, unsupported modes, and incomplete credentials without password leakage, plus present/absent/blank sender display names.
- [x] 2.2 Implement the injectable Nodemailer transport factory with required STARTTLS, implicit TLS, certificate verification, and optional authentication; verify unit tests capture the expected transport settings for both security modes and authentication combinations.
- [x] 2.3 Implement the asynchronous send operation with recipient/body validation, configured sender, result return, and error propagation without retries; verify isolated tests cover text, HTML, multiple recipients, invalid messages, successful submission, and failures.
- [x] 2.4 Wire the mail module and provider into NestJS with explicit injection tokens, with explicit startup resolution by main; verify a module-resolution test uses fake configuration/transport and sends no network traffic.
- [x] 2.5 Add the environment variable reference and authenticated STARTTLS/SSL examples to `docs/examples.md`; verify names, defaults, credential rules, and certificate behavior agree with configuration tests.

- [x] 2.6 Add an injectable NestJS logger configured for error-level stderr output only; cover configuration, validation, authentication, connection, TLS, and sending failures with tests verifying safe diagnostics, preserved failure propagation, and no duplicate entries.
- [x] 2.7 Verify real logger stderr output and absence of application log files/file transports; add tests ensuring credentials, mail contents, and raw SMTP exchanges are excluded, and document console-only error logging in `docs/examples.md`.

- [x] 2.8 Implement main initialization and the recurring loop awaiting 20000 ms before every send, with sequential submissions and continuation after failures; verify injected wait/send tests cover first delay, repeated messages, no overlap, and no duplicate error logs.
- [x] 2.9 Verify bounded source/built subprocess termination on SIGTERM/SIGINT and document recurring delivery, required message variables, and optional sender display name in `docs/examples.md` and the brief purpose README.

- [x] 2.10 Add reusable pooled transport and validate `SMTP_<PROFILE>_MAX_CONNECTIONS`, `SMTP_<PROFILE>_MAX_MESSAGES`, and `SMTP_<PROFILE>_MAX_PENDING` with defaults 5, 100, and 1000; verify unit tests cover option mapping, invalid limits, independent concurrent submissions, and per-message results/errors.
- [x] 2.11 Implement atomic bounded admission and typed capacity failures; verify saturation rejects promptly without transport enqueueing, settled calls release capacity once, and failure/overload logging remains safe and console-only.
- [x] 2.12 Implement idempotent sender shutdown, stopped admission, a single maximum 10-second drain across all profile pools, forced settlement at deadline, and pool cleanup wired to lifecycle/signals; verify shutdown tests cover pending work, late callbacks, repeated close, and no sends after shutdown.
- [x] 2.13 Add a separate controlled SMTP fixture test demonstrating connection reuse and concurrency with a bounded burst; verify connection/pending limits and record elapsed time and successful submissions without a fragile performance threshold.
- [x] 2.14 Document pool configuration, bounded concurrent API usage, capacity-error handling, shutdown, and memory-only pending submissions in `docs/examples.md`; verify examples agree with concurrency and overload tests.

- [x] 2.15 Implement and validate the named profile registry, required profile/default declarations, uppercase environment prefixes, and per-profile settings without unprefixed fallback; verify tests cover duplicate/invalid IDs, missing settings, default selection, and validation before transport creation.
- [x] 2.16 Add optional per-call profile routing and structured sender overrides with isolated pool counters and immutable defaults; verify tests cover unknown profiles, independent saturation/failures, concurrent distinct senders on one pool, override validation, and default preservation.
- [x] 2.17 Add `MAIL_SMTP_PROFILE` selection to recurring startup and aggregate pool shutdown; verify tests cover explicit/default/invalid selection, no broadcasting, and all pools closing within one shared deadline.
- [x] 2.18 Update `docs/examples.md` with complete primary/notifications environment, Docker and Compose examples plus concurrent profile/override API usage; verify documented variable names and defaults match registry tests and Compose validation.

## 3. Container distribution

- [x] 3.1 Add a multi-stage Dockerfile and `.dockerignore` using the pinned Bun version, minimal runtime, required CA assets, production artifacts, and fixed nonzero UID/GID; verify the image builds and excludes development tools, tests, local environment files, and credentials.
- [x] 3.2 Smoke-test invalid startup configuration and configured recurring image execution against a controlled local SMTP fixture and inspect its user, group, runtime dependencies, CA availability, and final image size; verify nonzero exit on invalid configuration, configured message delivery, prompt SIGTERM termination, no exposed ports, and the measured size.
- [x] 3.3 Add runnable Docker and Compose examples to `docs/examples.md` using GHCR image placeholders and runtime environment settings; verify Compose syntax with `docker compose config` and document the recurring 20-second delivery loop and explicit stop commands, console-only logs, and `docker logs` / `docker compose logs` commands without log volumes.

## 4. GitHub Actions validation and publishing

- [x] 4.1 Add workflows for pull requests, default-branch pushes, and `v*` tags with frozen install, type checking, isolated unit tests, production build, and Docker build; verify workflow syntax and run the same validation commands locally.
- [x] 4.2 Add a validation-gated GHCR publication job using `GITHUB_TOKEN`, package write permission, lowercase image paths, and SHA/latest/version tags; verify event conditions prevent publishing on pull requests or failed checks and tag generation matches the specification.
- [x] 4.3 Document image naming, publication triggers, and immutable tag use in `docs/examples.md`; verify documentation matches workflow conditions and generated tags.

## 5. End-to-end acceptance

- [x] 5.1 Run frozen installation, type checking, all tests, production build, bounded source/built recurring-loop and signal-termination checks, Docker build/smoke checks, and Compose validation together; verify the complete local path uses fake transports or a controlled local SMTP fixture without production credentials and all three capability specs are satisfied.
- [x] 5.2 Review workflow publication configuration and report any checks requiring a real eligible GitHub Actions run; distinguish locally verified behavior from publication that has actually executed.
