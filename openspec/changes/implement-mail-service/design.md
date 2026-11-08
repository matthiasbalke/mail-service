# Design

## Context

The repository contains only OpenSpec scaffolding; there is no source, dependency manifest, test suite, workflow, or existing SMTP implementation to preserve. See proposal.md for motivation. The user's clarification establishes that SMTP sending must be implemented in this change.

## Goals / Non-Goals

**Goals:** Keep the sender independently testable and reusable, resolve configuration only when mail functionality is explicitly initialized, and package the same tested output for Bun execution and containers.

**Non-Goals:** Incoming application authentication, HTTP endpoints, CLI commands, durable/external queues, cron scheduling, templates, and immediate retries. Authentication refers to SMTP server credentials.

## Decisions

### Bun, TypeScript, and NestJS without a server

Use Bun for package management, tests, builds, and execution. Use NestJS common/core and its required runtime dependencies to define a small mail module and provider. No HTTP adapter or server is needed. Keep the mail provider usable through explicit construction with injected configuration and transport; use explicit injection tokens rather than depending on emitted decorator parameter metadata. This avoids making Bun's metadata behavior a prerequisite. A server-oriented framework such as Express would introduce an unnecessary listener abstraction; a framework-free implementation would miss the requested Node framework.

The single asynchronous main function creates a Nest application context without an HTTP server, resolves the sender, and validates recurring-message configuration once. It then loops forever: await an abortable 20000 ms timer (`node:timers/promises` under Bun), call the implemented send operation with the configured message, and await completion. A failed attempt is already logged by the sender; catch it to continue without logging it twice. Wait another full 20 seconds after success or failure, so slow sends never overlap and there are no catch-up bursts. This is a fixed delay between attempts, not an exact wall-clock schedule. The first attempt follows the first wait.

Use `MAIL_TO` (comma-separated addresses), `MAIL_SUBJECT`, and `MAIL_TEXT`, all required and nonblank. Trim recipient entries and reject empty entries; preserve subject/body content after checking it is nonblank. Validate all configuration before entering the loop; log invalid startup configuration once and exit nonzero. SMTP authentication remains optional when the relay allows it. Preserve prompt SIGTERM/SIGINT termination, do not start further attempts during shutdown, and stop admission and close the sender through its bounded drain procedure, then close the application context.

### Nodemailer with explicit transport injection

Use Nodemailer to handle SMTP protocol details rather than building a protocol client. A narrow transport interface allows tests to capture settings, return submission results, and simulate failures. The mail operation accepts recipient(s), subject, and text and/or HTML; it uses the selected profile sender by default, with an optional message-local sender override. SMTP acceptance is reported as submission, not proof of inbox delivery. Do not add automatic retries because ambiguous SMTP failures can otherwise duplicate mail.

### Profile registry and message-local sender selection

Require `SMTP_PROFILES` (for example `primary,notifications`) and `SMTP_DEFAULT_PROFILE=primary`. Trim list entries, require unique lowercase IDs matching `[a-z][a-z0-9_]*`, and uppercase IDs to form prefixes such as `SMTP_PRIMARY_`. Validate the complete registry before creating any transports. Every listed profile supplies its own HOST and FROM, optional FROM_NAME and credentials, SECURITY/PORT, and pool limits. Preserve existing defaults within each profile. Use no unprefixed legacy fallback because this project has no deployed implementation to migrate.

Maintain an immutable profile registry with one lazily connected pooled transport and admission counter per profile. The send API accepts `profile?: string` and `from?: { address: string; name?: string }`. Omitted profile uses the configured default; unknown IDs reject before admission and never trigger fallback. An entire omitted sender uses profile defaults; an explicit sender replaces address/name for that message only, with no inherited display name when omitted. Build fresh message options for each call and never mutate shared defaults or credentials. SMTP provider authorization can still reject an override.

The recurring loop selects `MAIL_SMTP_PROFILE` when present, otherwise the default; validate selection at startup and use that pool’s sender defaults. Shutdown stops admission across all profiles at once and drains them concurrently under one shared 10-second deadline, rather than waiting 10 seconds per profile. Log safe profile IDs with error categories to distinguish failures without exposing credentials. Test profile parsing, routing, defaults, isolation, concurrent sender overrides, and aggregate shutdown.

### Concurrent sending and bounded pooling

Create one long-lived pooled Nodemailer transport per configured profile, not one transport per message. Configure pooling with `SMTP_<PROFILE>_MAX_CONNECTIONS=5` and `SMTP_<PROFILE>_MAX_MESSAGES=100` by default, both positive integers. Concurrent send calls immediately return independent promises and share this pool; avoid a global send mutex. The recurring main loop remains sequential by choice, while future callers can use bounded concurrent producers through the same API.

Bound all admitted unsettled submissions with `SMTP_<PROFILE>_MAX_PENDING=1000`, including those in flight and waiting inside the transport. Validate input before admission, reserve capacity synchronously before awaiting transport, and release it exactly once on every settlement path. Reject excess calls immediately with a typed capacity error rather than adding unbounded waiting promises. Log capacity failures through the existing console-only error logger. This provides explicit backpressure without adding a durable broker. Pool reuse removes repeated connection/authentication overhead; actual throughput still depends on server limits, latency, and message sizes. No numerical messages-per-second target is asserted.

Provide an idempotent asynchronous close operation: reject new calls, allow admitted work to drain for at most 10 seconds, then close all pools and reject any remaining application promises with a typed shutdown error. Observe late transport callbacks safely and avoid double settlement or leaked capacity. Connect close to Nest lifecycle and SIGTERM/SIGINT handling. Cancel the loop wait on shutdown so it cannot start another send; do not wait out the full 20-second interval. Close immediately when no submissions are pending. Finite transport timeouts remain enabled so stalled connections cannot retain resources indefinitely.

Verify concurrency, pool option mapping, reuse, isolated failures, saturation/recovery, and shutdown with deterministic transport doubles. Add a controlled local SMTP fixture check demonstrating connection reuse and concurrent in-flight submissions under load; record elapsed time and completed messages as observations, not a CI speed threshold. Keep network fixture tests separate from isolated unit tests. Document pool limits, backpressure handling, memory-only pending work, shutdown, and a bounded-concurrency programmatic usage example in `docs/examples.md`.

### Environment configuration and secure defaults

Provide a pure configuration parser accepting an environment map, called when explicitly constructing the sender. Use `SMTP_<PROFILE>_HOST` and `SMTP_<PROFILE>_FROM` as required values, trim and reject empty host/from, and strictly validate integer ports. Use optional `SMTP_<PROFILE>_FROM_NAME` as the sender display name, treating absent or blank values as address-only; pass a structured address/name object to Nodemailer rather than interpolating a header string. `SMTP_<PROFILE>_SECURITY=starttls` is the default with port 587; `ssl` selects implicit TLS with default port 465. Explicit valid ports override those defaults. Credentials are optional as a complete pair; preserve password contents and reject empty or partial pairs.

Map STARTTLS to `secure: false` plus `requireTLS: true`, and SSL to `secure: true`. Retain certificate verification and provide no insecure override. Reject invalid configuration before transport creation. Do not log credentials or entire configuration objects. This explicit mode is easier to document and validate than interacting SSL/STARTTLS boolean flags. Plaintext mode is outside the requested scope.

### Console-only error logger

Use the NestJS logger framework, configured to emit error-level entries to stderr only. Inject a narrow logger interface into sender initialization and delivery boundaries so tests can capture errors. Do not configure file transports, log directories, rotation, or filesystem writes. Native Docker log capture can consume stderr without any application log files or log volume.

Log configuration, message-validation, authentication, connection, TLS, and send failures at their handling boundary, then propagate the failure to the caller. Avoid duplicate logging when nested operations rethrow the same failure. Use fixed operation descriptions and allowlisted diagnostic categories/codes; never serialize raw errors, SMTP replies, configuration objects, or messages that could contain credentials or mail contents. Keep Nodemailer's protocol/debug logging disabled. Initialize logging before startup validation; the main boundary logs startup failures not already logged by sender initialization.

Test each failure category with an injected logger spy; separately capture stderr from the real logger to verify error-level console output and verify no file transport or application log files are created. Keep unit tests independent of real SMTP servers.

### Unit tests and builds

Use `bun test` with injected transport doubles and environment maps, avoiding global environment mutations where possible. Cover defaults, overrides, malformed ports, missing values, credential combinations, both TLS mappings, message validation, preserved content, successful results, and errors. Test recurring delivery with injected wait/send functions: verify the 20000 ms delay before the first and every subsequent attempt, exact message forwarding, no overlap, and continuation after failures. Test startup validation and sender display-name handling. Use bounded subprocess tests for signals and a controlled local SMTP fixture for successful delivery smoke tests; never use real recipients or production credentials. Unit tests assert that TLS is required and verification is enabled; they do not pretend to prove a real TLS handshake. Include a small Nest module-resolution test with a fake transport so framework wiring is actually exercised.

Commit a Bun lockfile; expose install-independent scripts for type checking, testing, and production builds. Build runnable output targeting Bun, and retain the reusable mail module in production artifacts alongside the recurring main function (for example, separate entry outputs). Do not let dead-code elimination remove the entire requested SMTP implementation from the distribution.

### Minimal Docker runtime

Use a multi-stage Dockerfile with a pinned Bun version shared with CI. Compile/build in the builder and copy only production output and any necessary production dependencies into a compatible official minimal Bun runtime, preferring its distroless variant when verified compatible. Include CA certificates needed for verified SMTP TLS. Use an explicit nonzero UID/GID and readable runtime files, no exposed ports, and no network healthcheck for this application. A scratch image was considered but adds runtime/CA packaging work without a defined numeric size target. Keep the final image small structurally and report its actual size; do not invent a size guarantee before building.

Use `.dockerignore` to exclude Git metadata, local environment files, tests, and unrelated planning files. No credentials enter build arguments or layers. Smoke-test invalid configuration and run the image with valid test configuration against a controlled local SMTP fixture and inspect its default UID/GID and image size.

### CI and publication

Validate pull requests, default-branch pushes, and `v*` tag pushes with frozen dependency installation, type checking, unit tests, production build, and Docker build. Gate GHCR publication on all checks succeeding and on trusted push events. Use Docker Buildx and standard login/metadata/build actions with least-privilege workflow permissions: read repository contents; grant package writes only to publication. Use `GITHUB_TOKEN`, lowercase the repository image path, and publish SHA plus latest/default-branch or version/release tags as specified. Build Linux amd64 initially; multi-architecture publishing is outside this initial scope. Pin chosen action revisions during implementation.

### Documentation placement

Keep lowercase `readme.md` to two or three purpose-focused sentences. Put variable reference, Docker run, Compose YAML, TLS modes, credential placeholders, console-only error logging, `docker logs` and `docker compose logs` usage, and recurring delivery behavior, all message/sender variables, two-profile Docker/Compose configurations, routing and override usage examples, and stop instructions into `docs/examples.md`. Compose uses no restart policy or explicitly `restart: "no"`. Examples use runtime environment values, no baked-in secrets or published ports.

## Risks / Trade-offs

- [Provider limits constrain throughput and pending messages are not durable] → Make concurrency configurable, reject overload explicitly, document relay limits and shutdown semantics, and avoid automatic retries after ambiguous failures.

- [NestJS adds dependencies and Bun integration assumptions] → Keep the module small, use explicit injection, and verify module resolution and production output with the selected versions.
- [A minimal runtime can omit required TLS assets or dependencies] → Verify the runtime contents and CA availability, and smoke-test the built artifacts in the final image.
- [The application repeatedly sends real messages when configured] → Document the recurring behavior clearly; use fake transports or a controlled SMTP fixture in verification and stop subprocess/container tests explicitly.
- [Unit tests cannot establish real SMTP interoperability] → Test transport contracts precisely; any later integration test must use a controlled local SMTP fixture rather than production credentials.
- [GHCR permissions depend on repository settings] → Use the built-in token and document any observed repository package permission issue when validating publication; never claim an image was published unless the workflow ran successfully.

## Migration Plan

There is no existing application or data to migrate. Introduce the source, tests, docs, and CI together. Verify locally before merging; the first eligible successful push publishes the image. Roll back a published deployment by selecting a prior immutable SHA tag. Removing this initial application has no state migration implications.
