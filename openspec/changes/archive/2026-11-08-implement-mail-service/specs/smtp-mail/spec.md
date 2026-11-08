# Spec Delta

## Purpose

Provide reusable SMTP email delivery configured through environment variables, including authenticated connections and secure transport.

## ADDED Requirements

### Requirement: Environment configuration
The sender SHALL read `SMTP_<PROFILE>_HOST`, `SMTP_<PROFILE>_PORT`, `SMTP_<PROFILE>_SECURITY`, `SMTP_<PROFILE>_USER`, `SMTP_<PROFILE>_PASSWORD`, `SMTP_<PROFILE>_FROM`, and optional `SMTP_<PROFILE>_FROM_NAME` from environment variables when initialized. `SMTP_<PROFILE>_HOST` and `SMTP_<PROFILE>_FROM` SHALL be required. `SMTP_<PROFILE>_SECURITY` SHALL default to `starttls`; supported values SHALL be `starttls` and `ssl`. Ports SHALL default to 587 for STARTTLS and 465 for SSL.

#### Scenario: Default secure configuration
- **WHEN** the sender is initialized with a host and sender address and no explicit port or security mode
- **THEN** it uses STARTTLS on port 587

#### Scenario: Explicit configuration
- **WHEN** a valid explicit port and security mode are provided
- **THEN** the sender uses those configured values

#### Scenario: Invalid configuration
- **WHEN** required configuration is missing, the port is not an integer from 1 through 65535, or the security mode is unsupported
- **THEN** initialization fails before connecting with an actionable error that does not expose passwords

### Requirement: SMTP authentication
The sender SHALL authenticate with the configured username and password when both are present, omit authentication when both are absent, and reject a partial or empty credential pair.

#### Scenario: Authenticated delivery
- **WHEN** both credentials are configured and a message is sent
- **THEN** the sender supplies both credentials to the SMTP transport

#### Scenario: Relay without authentication
- **WHEN** neither credential is configured
- **THEN** the sender does not supply authentication credentials

#### Scenario: Incomplete credentials
- **WHEN** only one credential is set or a supplied credential is empty
- **THEN** initialization fails without revealing credential values

### Requirement: Encrypted SMTP transport
The sender SHALL require a TLS upgrade in `starttls` mode and establish TLS immediately in `ssl` mode. It SHALL verify server certificates and SHALL NOT fall back to plaintext.

#### Scenario: STARTTLS delivery
- **WHEN** a message is sent in STARTTLS mode
- **THEN** TLS is required before authentication or message delivery

#### Scenario: Server cannot upgrade
- **WHEN** the SMTP server does not support the required TLS upgrade
- **THEN** delivery fails without sending the message in plaintext

#### Scenario: Implicit TLS delivery
- **WHEN** a message is sent in SSL mode
- **THEN** the connection uses TLS from its beginning

#### Scenario: Untrusted certificate
- **WHEN** the server certificate fails validation
- **THEN** delivery fails

### Requirement: Programmatic email delivery
The service SHALL expose an asynchronous programmatic operation accepting one or more recipients, a subject, and text and/or HTML content. It SHALL use the selected profile sender unless the call supplies an explicit sender override, reject messages missing recipients or body content before delivery, return the SMTP submission result on success, and propagate submission failures to the caller without automatically retrying.

#### Scenario: Submit a message
- **WHEN** a caller submits a valid message
- **THEN** its recipients, subject, and supplied body formats are submitted once with the configured sender and the submission result is returned

#### Scenario: Invalid message
- **WHEN** a message has no recipients or neither text nor HTML content
- **THEN** it is rejected before the transport is called

#### Scenario: SMTP failure
- **WHEN** the transport rejects a submission
- **THEN** the caller receives a failure and no automatic retry occurs


### Requirement: Console-only error logging
The service SHALL log configuration, authentication, connection, TLS, message-validation, and mail-sending failures through a logger framework at error level to stderr. It SHALL NOT write application logs to disk or configure file transports. Logging SHALL preserve failure propagation and exclude credentials, email contents, and raw SMTP exchanges.

#### Scenario: Operational failure
- **WHEN** authentication, connection, TLS negotiation, or message submission fails
- **THEN** an error-level console entry identifies the failed operation and a safe diagnostic category or code, and the failure remains visible to the caller

#### Scenario: Invalid input or configuration
- **WHEN** sender initialization or message validation fails
- **THEN** the service emits an error-level console entry before propagating the validation failure

#### Scenario: Sensitive diagnostic values
- **WHEN** a failure contains credentials, message contents, or raw SMTP exchanges
- **THEN** those values are excluded from the log entry

#### Scenario: No disk logging
- **WHEN** any service error is logged
- **THEN** the logger writes to stderr without creating or modifying application log files


### Requirement: Sender display name
The sender SHALL use the selected profile’s `SMTP_<PROFILE>_FROM` address and optional `SMTP_<PROFILE>_FROM_NAME` display name by default. An absent or blank display name SHALL produce an address-only sender. The display name SHALL NOT change the sender address.

#### Scenario: Named sender
- **WHEN** both sender variables are configured
- **THEN** submitted messages include the configured address and display name

#### Scenario: Address-only sender
- **WHEN** `SMTP_<PROFILE>_FROM_NAME` is absent or blank
- **THEN** submitted messages use `SMTP_<PROFILE>_FROM` without a display name


### Requirement: Concurrent asynchronous submissions
The sender SHALL accept concurrent calls without requiring callers to await earlier submissions. Each call SHALL return its own promise resolving only after SMTP submission or rejecting on failure. The sender SHALL reuse a bounded pool of SMTP connections and SHALL NOT serialize all calls through a single global lock or block the event loop during network operations.

#### Scenario: Concurrent callers
- **WHEN** multiple valid submissions arrive while pool capacity is available
- **THEN** more than one submission can be in progress and each caller receives its own matching result or failure

#### Scenario: Isolated submission failure
- **WHEN** one concurrent submission fails
- **THEN** its promise rejects and unrelated submissions retain their own results

### Requirement: Bounded submission capacity
Each profile SHALL independently support positive integer `SMTP_<PROFILE>_MAX_CONNECTIONS` (default 5), `SMTP_<PROFILE>_MAX_MESSAGES` per connection (default 100), and `SMTP_<PROFILE>_MAX_PENDING` total unsettled submissions (default 1000). It SHALL reject invalid values at initialization. Calls exceeding pending capacity SHALL reject promptly with a distinguishable capacity error, logged at error level, without entering the transport queue.

#### Scenario: Pool and connection reuse
- **WHEN** submissions exceed available connections but remain within pending capacity
- **THEN** connection usage stays within its configured limit and reusable connections serve subsequent submissions

#### Scenario: Saturation and recovery
- **WHEN** pending capacity is reached
- **THEN** additional submissions reject without increasing retained work and capacity becomes available when an admitted submission settles

#### Scenario: Invalid limits
- **WHEN** a pool or pending limit is zero, negative, noninteger, or malformed
- **THEN** initialization logs a safe configuration error and fails before delivery

### Requirement: Sender shutdown
The sender SHALL expose asynchronous shutdown that stops accepting submissions across all profiles, drains admitted work under one shared deadline of at most 10 seconds, and releases all pooled resources. At the deadline, unsettled calls SHALL reject with a shutdown error and resources SHALL close. Submissions after shutdown begins SHALL reject promptly. Pending work SHALL remain memory-only, without a durable queue or delivery guarantee across process termination.

#### Scenario: Drain outstanding work
- **WHEN** shutdown begins with admitted submissions
- **THEN** they can complete within the drain deadline, new calls reject, and pooled resources are released

#### Scenario: Shutdown deadline
- **WHEN** admitted work has not settled after 10 seconds of shutdown
- **THEN** its callers receive shutdown failures and pooled resources are released without waiting indefinitely


### Requirement: Named SMTP profiles
`SMTP_PROFILES` SHALL list unique comma-separated profile IDs matching `[a-z][a-z0-9_]*`. Each SHALL map to its uppercased `SMTP_<PROFILE>_` prefix and own pool, credentials, sender defaults, and capacity limits. `SMTP_DEFAULT_PROFILE` SHALL name a listed profile. Both variables SHALL be required; invalid lists, defaults, or profile settings SHALL fail startup with a safe error log before transport creation. Unprefixed SMTP settings SHALL NOT act as fallbacks.

#### Scenario: Two configured profiles
- **WHEN** `SMTP_PROFILES=primary,notifications` and both profiles and the default are valid
- **THEN** settings are read from `SMTP_PRIMARY_*` and `SMTP_NOTIFICATIONS_*` and one reusable pool is created per profile

#### Scenario: Invalid profile declarations
- **WHEN** the profile list has missing, empty, duplicate, or invalid IDs, the default is unknown, or any listed profile is invalid
- **THEN** startup logs a safe configuration error and fails without opening SMTP connections

### Requirement: Per-message profile selection
A send call SHALL accept an optional profile ID and otherwise use `SMTP_DEFAULT_PROFILE`. Unknown IDs SHALL reject with an error-level console entry before admission. Pools SHALL remain isolated: neither failures nor capacity exhaustion in one profile SHALL block available capacity in another. No automatic fallback to another profile SHALL occur.

#### Scenario: Select or default profile
- **WHEN** a call specifies a known profile or omits the profile
- **THEN** it uses the specified pool or the configured default pool respectively

#### Scenario: Unknown profile
- **WHEN** a call specifies an undeclared profile
- **THEN** it rejects before any transport submission and logs a safe profile-selection error

#### Scenario: Independent pool capacity
- **WHEN** one profile is saturated or has a submission failure
- **THEN** another profile continues accepting and processing calls within its own limits

### Requirement: Per-message sender override
A send call SHALL accept an optional structured sender address and display name. An override SHALL apply only to that message, SHALL require a nonempty address, and SHALL NOT modify profile defaults, credentials, or other concurrent submissions. Omitting the entire override SHALL use profile defaults; omitting its display name SHALL send an address-only sender. The SMTP server remains authoritative on permitted sender addresses.

#### Scenario: Concurrent different senders
- **WHEN** concurrent messages select the same profile but provide different sender overrides
- **THEN** each message uses its own sender while sharing the pool and leaving profile defaults unchanged

#### Scenario: Missing override address
- **WHEN** a sender override lacks a nonempty address
- **THEN** validation rejects and logs a safe error before transport submission
