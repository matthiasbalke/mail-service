# Configuration and usage

The application waits 20 seconds before sending its first configured message. After each attempt finishes, it waits another 20 seconds and sends again. Attempts do not overlap; failures are logged and the loop continues. Startup configuration errors cause a nonzero exit before any delivery.

## Environment configuration

Copy `docs/.env.example` to `local/.env` (create `local/` first), then replace the placeholder hosts, credentials, sender addresses, and recipient. Values are read once at startup; restart the service to change them. Keep the resulting credentials file out of Git.

| Variable | Meaning | Default |
| --- | --- | --- |
| `SMTP_PROFILES` | Required comma-separated unique profile IDs, for example `primary,notifications` | Required |
| `SMTP_DEFAULT_PROFILE` | Required ID of a listed profile | Required |
| `MAIL_SMTP_PROFILE` | Profile used by the recurring loop | Default SMTP profile |
| `MAIL_TO` | Nonempty comma-separated recipient addresses | Required |
| `MAIL_SUBJECT` | Nonblank recurring message subject | Required |
| `MAIL_TEXT` | Nonblank recurring plain-text message body | Required |

Profile IDs use lowercase letters, digits, and underscores, starting with a letter. They become uppercase in environment prefixes: `notifications` reads `SMTP_NOTIFICATIONS_*`. Empty or duplicate IDs, unknown profile selections, and invalid settings fail validation. Unprefixed settings such as `SMTP_HOST` or `SMTP_FROM` are not used.

For **each** declared profile, configure these suffixes after `SMTP_<UPPERCASE_PROFILE>_`:

| Suffix | Meaning | Default |
| --- | --- | --- |
| `HOST` | SMTP server hostname | Required |
| `PORT` | Integer port from 1 through 65535 | 587 for STARTTLS; 465 for SSL |
| `SECURITY` | `starttls` requires a TLS upgrade; `ssl` uses TLS immediately | `starttls` |
| `USER` | SMTP authentication username | Omitted, for a relay that allows unauthenticated clients |
| `PASSWORD` | SMTP authentication password, preserved verbatim | Omitted |
| `FROM` | Default sender email address | Required |
| `FROM_NAME` | Optional sender display name; absent/blank uses address only | Omitted |
| `MAX_CONNECTIONS` | Maximum simultaneous connections in this pool | 5 |
| `MAX_MESSAGES` | Messages per connection before reconnecting | 100 |
| `MAX_PENDING` | Maximum admitted unsettled submissions, including queued and in-flight work | 1000 |

Supply both nonempty username and password or omit both entirely. All pool limits must be positive safe integers. TLS certificates are verified; there is no plaintext fallback or verification bypass. The sample file provides authenticated STARTTLS for `primary` and SSL for `notifications`. To use only one profile, list only that profile, set it as default, and omit `MAIL_SMTP_PROFILE` or select it explicitly.

`SMTP_PRIMARY_FROM` and `SMTP_PRIMARY_FROM_NAME`, for example, are message defaults for the primary pool. Different sender addresses can share a pool, provided the SMTP account is authorized to send as those addresses. Different servers or credentials use separate profiles. All declared profiles are validated before any transport is created; SMTP connections open on demand.

## Docker

```sh
mkdir -p local
cp docs/.env.example local/.env
# Edit local/.env before starting; the app repeatedly sends real emails.
docker run -d --name mail-service \
  --env-file local/.env \
  --mount "type=bind,source=$(pwd)/local/certs/ca.crt,target=/tmp/ca.crt,readonly" \
  --read-only --cap-drop ALL --security-opt no-new-privileges \
  --stop-timeout 15 \
  ghcr.io/matthiasbalke/mail-service:latest

docker logs -f mail-service
docker stop -t 15 mail-service
docker rm mail-service
```

The CA mount above is required when using the supplied `NODE_EXTRA_CA_CERTS=/tmp/ca.crt` setting; generate it as shown in the Compose example below. Remove that setting and mount when using only publicly trusted certificates.

The image runs as UID/GID `65532:65532`, exposes no ports, and needs no persistent volumes. Both profiles from the environment file are available; only `MAIL_SMTP_PROFILE` is used by the recurring loop. Error-level logs go to the console (stderr) using the NestJS logger. The app never writes log files and does not log credentials, email contents, or raw SMTP exchanges. Docker may retain console output through its own logging driver.

## Docker Compose

`docs/compose.yaml` uses `local/.env` and includes a Mailpit test SMTP server. Generate its certificates with mkcert, then copy the local CA certificate into the mount directory. Run these commands from the repository root (the helper scripts require zsh):

```sh
mkdir -p local
cp docs/.env.example local/.env
zsh scripts/generate-local-https-certificates.zsh
cp "$(mkcert -CAROOT)/rootCA.pem" local/certs/ca.crt
# Edit local/.env with your SMTP settings and message.
zsh app.zsh config --quiet
zsh app.zsh up -d
zsh app.zsh logs -f mail
zsh app.zsh down
```

The mail container uses a read-only filesystem, mounts the CA certificate, and exposes no ports. Mailpit publishes SMTP on loopback port 1025 and its web UI on port 8025. To use it, configure the selected profile with host `smtp.dev.example.com`, port `1025`, security `starttls`, and the same user/password as `SMTP_USER`/`SMTP_PASSWORD`. The example defaults still point profiles at placeholder external hosts. Compose restarts the mail container unless stopped; its 15-second stop grace period accommodates the shared maximum 10-second sender drain.

## Programmatic sending

Install dependencies with Bun 1.4.4 using `bun install --frozen-lockfile`. The reusable API is exported from `src/index.ts` and built as `dist/index.js`. Importing it does not start the recurring loop.

```ts
import { MailService, parseConfiguration, createLogger, CapacityError } from './src/index';

const mailService = new MailService(parseConfiguration(process.env), createLogger());
try {
  await mailService.send({
    profile: 'notifications', // Omit to use SMTP_DEFAULT_PROFILE.
    from: { address: 'alerts@example.org', name: 'System Alerts' },
    to: ['recipient@example.net'],
    subject: 'Service notification',
    text: 'Your report is ready.',
    html: '<p>Your report is ready.</p>', // text and/or html are supported.
  });
} catch (error) {
  if (error instanceof CapacityError) {
    // Pause your producer until work settles; do not submit an unbounded burst.
  } else {
    throw error;
  }
} finally {
  await mailService.close();
}
```

Omitting `from` uses the selected profile's sender defaults. An explicit override must include an address; omitting its name gives an address-only sender. Overrides are local to each submission and never mutate another message or the shared pool. Unknown profiles reject without falling back to another server. Each call returns its own promise with the SMTP submission result; SMTP acceptance does not guarantee inbox delivery.

For higher throughput, reuse one service and use a bounded number of workers:

```ts
const concurrency = 5;
const iterator = messages[Symbol.iterator](); // Your iterable of MailMessage objects.
try {
  await Promise.all(Array.from({ length: concurrency }, async () => {
    for (let item = iterator.next(); !item.done; item = iterator.next()) {
      try { await mailService.send(item.value); }
      catch (error) {
        // Record the failed result or pause production on CapacityError.
        // The service has already logged a safe error; it does not retry.
      }
    }
  }));
} finally {
  await mailService.close();
}
```

Each pool enforces its own connection and pending limits. Excess submissions reject promptly with `CapacityError`; one overloaded or failing profile does not consume another's capacity. Pending work lives only in memory, with no durable queue or automatic retry. Throughput depends on provider limits, latency, and message size. On shutdown, all profiles stop admission together and drain concurrently for at most 10 seconds; outstanding calls then reject with `ShutdownError`, and all pooled connections close. A shutdown failure can have an ambiguous delivery outcome; the application does not retry it automatically.

## Build and verification

```sh
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run build
bun run test:integration
# Integration tests require openssl and use a controlled local SMTP server.
docker build -t mail-service:local .
bun scripts/docker-smoke.ts mail-service:local
```

`bun test` runs both unit and integration tests after `bun run build`; `bun run test` runs only isolated unit tests. The Docker smoke test uses disposable containers and generated test certificates to verify STARTTLS, recurring delivery, non-root execution, and shutdown, and reports final image size. It never needs real SMTP credentials. Production builds include only application output and production dependencies in a distroless Bun runtime; development tools and tests are excluded.

## Native builds and release promotion

The build workflow validates pull requests and pushes to `main`. Required application checks and Compose validation run first. The image matrix uses native amd64 (`ubuntu-24.04`) and arm64 (`ubuntu-24.04-arm`) runners with separate architecture caches; it uses no emulation. Each architecture runs the Docker smoke test for runtime identity, CA trust, TLS mail delivery, and shutdown. The repository must have access to both runner labels.

Pull requests load and test local images without registry login or publication. Main builds push run-specific `candidate-<commit>-<run-id>-<attempt>-<architecture>` tags and smoke-test their exact digests. A candidate is not release eligible. Only after both architectures and all required checks pass does the publication job assemble their exact descriptors and attestations into `ghcr.io/matthiasbalke/mail-service:sha-<full-commit-sha>`. It also updates `latest` when the commit is still main HEAD. Reruns preserve an existing verified SHA digest. Keep verified SHA tags and their referenced blobs for as long as releases need them; automation treats them as immutable, although the registry does not enforce this convention. Candidate tags can be cleaned up independently after runs finish.

Publication uses `GITHUB_TOKEN` with `contents: read` and `packages: write`; the GHCR package must grant this repository access. A passing local test does not confirm registry publication: check the actual build workflow and its verified-image summary.

The separate promotion workflow reacts to **unprefixed SemVer tag pushes**, such as `1.2.3` or `1.2.3-rc.1`. It resolves lightweight or annotated tags to their commit, reads that commit's verified SHA image, and assigns its exact digest to the literal version Docker tag. It never rebuilds or changes `latest`. It rejects v-prefixed tags, malformed versions, and `+build` metadata (Docker tags cannot contain `+`). GitHub release publication alone does not trigger promotion.

After main publication succeeds, create a tag for that verified commit:

```sh
git tag 1.2.3 <verified-full-commit-sha>
git push origin 1.2.3
# After the promotion workflow succeeds, compare these digest values:
docker buildx imagetools inspect ghcr.io/matthiasbalke/mail-service:sha-<verified-full-commit-sha>
docker buildx imagetools inspect ghcr.io/matthiasbalke/mail-service:1.2.3
```

If the tag arrives before a verified image exists, promotion fails: wait for main publication, then rerun the failed promotion workflow. Repeating the same promotion succeeds without writing; a version tag already pointing at a different digest fails without overwriting. Workflow concurrency serializes writers per image/version, but independent external registry writers must follow the same policy.

The reusable action lives in [`.github/actions/promote-image`](../.github/actions/promote-image/README.md). Its three inputs are image repository, source commit SHA, and destination Docker tag. It uses the caller's registry login. Later it can be copied intact into its own action repository and callers can switch from the local path to a pinned remote `uses:` reference without changing inputs or the saved SHA mapping.
