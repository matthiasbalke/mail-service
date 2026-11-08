# container-distribution Specification

## Purpose

Make the service reproducibly verifiable and distributable as a small, unprivileged container with practical deployment examples.

## Requirements

### Requirement: Small unprivileged runtime image
The project SHALL provide a multi-stage Docker build producing a minimal Bun runtime image containing only runtime requirements, excluding development dependencies, build tools, tests, and credentials. The image SHALL run as a fixed nonzero UID and GID and require no privileged ports or root permissions. The build SHALL report the final image size.

#### Scenario: Build and inspect image
- **WHEN** the image is built and inspected
- **THEN** it contains runnable application artifacts and runtime requirements, has a non-root default user, and has its size reported

#### Scenario: Run image
- **WHEN** the image runs with its default command and valid SMTP and recurring message configuration
- **THEN** it runs the recurring send loop as an unprivileged user without exposing ports

### Requirement: Automated validation
GitHub Actions SHALL perform frozen Bun dependency installation, type checking, unit tests, a production build, and a Docker build on pull requests and pushes to the default branch. Validation SHALL not require SMTP credentials.

#### Scenario: Pull request checks
- **WHEN** a pull request is opened or updated
- **THEN** all validation steps execute without publishing an image

### Requirement: GHCR publication
GitHub Actions SHALL publish the image to `ghcr.io/<lowercase-owner>/<lowercase-repository>` only after successful validation on default-branch pushes or version tags matching `v*`. Publications SHALL include a commit-specific tag; default-branch publications SHALL also use `latest` and version-tag publications SHALL use the version tag. Publishing SHALL use the workflow token with package write permission.

#### Scenario: Publish default branch
- **WHEN** a default-branch push passes validation
- **THEN** its image is published with commit-specific and latest tags

#### Scenario: Publish release tag
- **WHEN** a version tag matching `v*` passes validation
- **THEN** its image is published with commit-specific and version tags

#### Scenario: Failed validation
- **WHEN** a required validation step fails
- **THEN** no image is published for that workflow run

### Requirement: Concise purpose and deployment documentation
`readme.md` SHALL describe the service's purpose in only a few sentences. `docs/examples.md` SHALL contain Docker run and Docker Compose examples, all supported environment variables and defaults, STARTTLS and SSL configurations, authentication examples with placeholder secrets, and an explanation that the application repeatedly sends the configured message with a 20-second wait before each attempt. The examples SHALL explain how to stop the running application.

#### Scenario: Follow deployment examples
- **WHEN** a reader follows the Docker or Compose example using their own configuration
- **THEN** the image starts with the documented environment values and remains running and submits the configured message after each 20-second wait

#### Scenario: Discover SMTP configuration
- **WHEN** a reader consults the examples document
- **THEN** they can configure authenticated STARTTLS or SSL delivery without needing undocumented environment variables


### Requirement: Container console log documentation
`docs/examples.md` SHALL explain that application errors are emitted at error level to the console only and SHALL show how to inspect them with Docker and Compose log commands. Examples SHALL require no application log directory or log volume.

#### Scenario: Inspect container errors
- **WHEN** a reader consults the logging examples
- **THEN** they find `docker logs` and `docker compose logs` commands and understand that the application writes no log files


### Requirement: Multiple-profile deployment examples
`docs/examples.md` SHALL include a complete two-profile environment configuration and matching Docker/Compose examples. It SHALL document profile/default selection, prefixed settings and defaults, per-profile limits, `MAIL_SMTP_PROFILE`, and programmatic profile/sender overrides. It SHALL explain that sender overrides are subject to server authorization and credentials remain attached to profiles.

#### Scenario: Configure and use two pools
- **WHEN** a reader follows the primary/notifications examples
- **THEN** both pools are configured independently, the recurring loop selects one pool, and API examples show profile routing and message-local sender overrides
