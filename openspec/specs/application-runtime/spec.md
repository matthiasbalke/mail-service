# application-runtime Specification

## Purpose

Define the initial Bun application's execution behavior so future integrations can use its mail functionality without exposing a user interface.

## Requirements

### Requirement: Recurring email entry point
The application SHALL provide one asynchronous main function executed through Bun at startup. It SHALL initialize the sender and recurring message once, then endlessly await a non-blocking 20000 ms timer before each call to the implemented send operation. It SHALL await each submission before starting the next wait, preventing overlapping sends.

#### Scenario: First and subsequent messages
- **WHEN** the application starts with valid configuration
- **THEN** it waits 20 seconds before sending the configured message and waits another 20 seconds after each completed attempt before sending again

#### Scenario: Failed submission
- **WHEN** a send attempt fails
- **THEN** the failure is logged once at error level to the console and the loop continues after the next 20-second wait without an immediate retry

#### Scenario: Yield without busy waiting
- **WHEN** the loop is waiting for its timer or a submission
- **THEN** it yields the event loop instead of spinning or blocking it

#### Scenario: Terminate the application
- **WHEN** the running application receives SIGTERM or SIGINT
- **THEN** it terminates promptly without starting further submissions

### Requirement: Recurring message configuration
The application SHALL require nonempty `MAIL_TO`, `MAIL_SUBJECT`, and `MAIL_TEXT` environment variables for the recurring recipient, subject, and plain-text body. `MAIL_TO` SHALL accept a comma-separated list of addresses, trimming each entry and rejecting empty entries. Invalid SMTP or message configuration SHALL produce an error-level console entry and a nonzero exit before the loop starts.

#### Scenario: Configure recurring email
- **WHEN** valid SMTP and recurring message variables are supplied
- **THEN** every loop submission uses the configured recipients, subject, and text

#### Scenario: Missing or invalid configuration
- **WHEN** a required variable is missing, blank, or contains an empty recipient entry
- **THEN** startup logs a safe error and exits nonzero without attempting delivery

### Requirement: No interactive or network interface
The application SHALL expose no application CLI commands, HTTP endpoints, or web interface.

#### Scenario: Start the application
- **WHEN** the application is started
- **THEN** it does not listen on a network port or prompt for user input

### Requirement: Reproducible build and unit tests
The project SHALL provide locked Bun dependency installation and commands for type checking, building runnable output, and executing isolated unit tests. Unit tests SHALL cover SMTP configuration, authentication and security options, message submission, and failure propagation without external SMTP credentials or servers.

#### Scenario: Fresh checkout validation
- **WHEN** dependencies are installed using the committed lockfile and validation commands run
- **THEN** type checking, unit tests, and the production build succeed without SMTP network access

#### Scenario: Run built output
- **WHEN** the production build output is executed with Bun
- **THEN** it retains the recurring submission and termination behavior


### Requirement: Recurring SMTP profile selection
The recurring loop SHALL use optional `MAIL_SMTP_PROFILE`, defaulting to `SMTP_DEFAULT_PROFILE` when absent. A supplied value SHALL name a declared profile; blank or unknown values SHALL fail startup with an error-level console entry. The loop SHALL use that profile’s sender defaults and SHALL NOT send through every configured profile.

#### Scenario: Selected recurring pool
- **WHEN** `MAIL_SMTP_PROFILE=notifications` names a configured profile
- **THEN** every recurring message is submitted through notifications using its sender defaults

#### Scenario: Default recurring pool
- **WHEN** `MAIL_SMTP_PROFILE` is absent
- **THEN** recurring messages use the configured default profile

#### Scenario: Invalid recurring pool
- **WHEN** `MAIL_SMTP_PROFILE` is blank or unknown
- **THEN** startup logs a safe error and exits nonzero before entering the loop
