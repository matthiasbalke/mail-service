# Design

## Context

See proposal.md for motivation. `.github/workflows/ci.yaml` currently validates on PR/main/v* pushes, loads and smoke-tests an amd64 image, then builds again to publish SHA/latest/version tags. `Dockerfile` uses the same pinned Bun version in all stages and has no architecture-specific commands. `scripts/docker-smoke.ts` accepts any image reference and checks runtime identity, CA trust, STARTTLS delivery, and shutdown.

Reference inspection at katzenwanderweg commit `4527b73a7120e4b9e660816639db1b496dd5d7cd`:

- [build-candidates.yaml](https://github.com/katzenwanderweg/katzenwanderweg/blob/4527b73a7120e4b9e660816639db1b496dd5d7cd/.github/workflows/build-candidates.yaml) builds native platform candidates in a runner matrix and combines their digests.
- [verify.yaml](https://github.com/katzenwanderweg/katzenwanderweg/blob/4527b73a7120e4b9e660816639db1b496dd5d7cd/.github/workflows/verify.yaml) smoke-tests exact candidates and only then publishes verified `sha-<commit>` references.
- [promote-images.yaml](https://github.com/katzenwanderweg/katzenwanderweg/blob/4527b73a7120e4b9e660816639db1b496dd5d7cd/.github/workflows/promote-images.yaml) reacts to published releases, executes trusted main automation, resolves the peeled tag commit, and invokes digest promotion. Its scripts enforce same-digest retries and reject release conflicts.

We retain that registry mapping and digest-copy pattern, adapting the event to v* tag pushes and removing its hardcoded repository list, private-package policy, and multi-platform-only restriction from the reusable action. Existing main specs are empty; `implement-mail-service` still carries the original container distribution delta. Do not modify that separate change during this proposal; reconcile its publication contract before archival.

## Goals / Non-Goals

**Goals:** A small composite action that can be copied intact into its own repository; a two-workflow release path; native verification of the exact images published.

**Non-Goals:** Creating the separate action repository now; changing katzenwanderweg; a generic build framework; cross-registry copying; semver alias generation; release-publication triggers; emulated builds; artifact storage as the long-term digest database; automatic rebuilding or waiting when a release precedes publication.

## Decisions

### Registry tags save the mapping

Use `<image>:sha-<full lowercase commit SHA>` as the durable lookup record. GHCR already stores the digest and image, so no JSON file, release asset, Git commit, or cross-run artifact search is needed. Build outputs remain useful within a run but are not the release lookup mechanism. Keep SHA tags for as long as releases may reference those commits.

Treat verified SHA tags as write-once in our automation. Rerunning a main build reuses an existing verified index after confirming its required platform descriptors rather than replacing it with a potentially different rebuild. This is a workflow convention, not registry-enforced immutability.

### Native build matrix, then a single publication job

Keep required application checks and Compose checks in CI. Use explicit matrix entries `amd64 / ubuntu-24.04 / linux/amd64` and `arm64 / ubuntu-24.04-arm / linux/arm64`, with fail-fast disabled and separate architecture cache scopes. No QEMU setup. These are native runner labels documented by [GitHub](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).

For PRs, load and smoke-test each locally built image; do not log in or write to GHCR. For trusted main builds, push each native candidate with a run-specific tag such as `candidate-<sha>-<run-id>-<attempt>-<arch>`, capture its digest, and pull/run that exact digest for the smoke test in the same native job. This avoids a second application build and validates exactly what will be assembled. Candidate images can exist when checks fail; they are not eligible sources for release promotion.

The final job depends on all required checks and both successful native jobs. Resolve the two deterministic candidate references to digest-qualified sources and combine them into an index, preserving their descriptors and attestations. Verify exactly one runnable amd64 and one runnable arm64 descriptor before assigning the verified SHA tag. Only this job writes SHA/latest. Serialize main publication and avoid moving latest backwards when an older run completes after a newer main commit; skip latest updates for stale main commits. A retry preserves an existing verified SHA digest. A matrix with emulation was rejected because native execution is explicitly required.

### Self-contained promotion action

Place `action.yml`, a small Bash script, tests, and usage documentation under `.github/actions/promote-image`. Inputs: `image` (registry/repository without tag or digest), `source-sha` (40 lowercase hex characters), and `destination-tag` (one valid Docker tag). Outputs: `digest` and `image` (`<repository>@<digest>`). Require Linux, Bash, jq, Docker Buildx, and prior registry login; the caller owns checkout, Buildx setup, token permissions, and login.

Resolve helper scripts through `github.action_path`, not workspace-relative mail-service paths. Do not read event payloads or use Bun, npm dependencies, fixed GHCR names, or mail-service code inside the action. Initially callers use `./.github/actions/promote-image`; after extraction they use `owner/repository@<pinned-ref>` with identical inputs.

Validate inputs before registry writes. Inspect the source and capture its digest once. Inspect the destination: matching digest means success without writing; different digest means failure. Only an explicit missing-manifest result counts as absent; denied access, timeouts, and malformed responses fail. Copy from the digest-qualified source with `docker buildx imagetools create --prefer-index=false --tag ...`, then inspect the destination and require digest equality. Docker documents index copying and preservation of single-manifest format via [prefer-index](https://docs.docker.com/reference/cli/docker/buildx/imagetools/create/). Do not filter platforms or add annotations during promotion.

Keep inspection/copy behavior in this one action, rather than building a new publication library. Include digest and destination in outputs and the step summary, without credentials.

### Tag pushes select the release commit

Add `.github/workflows/promote-images.yaml` with `push.tags: ['v*']`; remove tag events from the build workflow. The workflow uses contents read and packages write permissions, logs in with `GITHUB_TOKEN`, and invokes the action with the literal Git tag as `destination-tag`. No prefix stripping, floating version aliases, or latest updates.

Checkout trusted automation from main with credentials persistence disabled and fetch the pushed tag explicitly. Peel `refs/tags/<tag>^{commit}` and compare it to the event commit, supporting lightweight and annotated tags and detecting a moved ref. Pass tag/input values through environment variables and quoted arguments. Never execute scripts from the release commit. A missing verified source fails promptly; the operator reruns the failed promotion after main publication succeeds. Do not add a polling/orchestration workflow.

Serialize promotion by repository/image and release tag, with no cancellation of an active promotion. Registry writes lack compare-and-swap; all cooperating callers must use that lock, and independent external writers remain outside its guarantee.

## Risks / Trade-offs

- [Tag pushed before verification finishes] → Fail with a clear recovery instruction and rerun after successful publication.
- [Deletion or external mutation of SHA tags] → Document retention and write-once conventions; missing sources fail, and release conflicts never overwrite.
- [Architecture or pinned Bun image incompatibility] → Run the existing Dockerfile and smoke tests on both native runners before enabling publication; do not substitute emulation.
- [Action extraction breaks relative paths] → Keep every action dependency under its own directory and verify use from a workspace without mail-service files.
- [More CI jobs and candidate images] → Matrix builds replace the current publish rebuild, reuse architecture caches, and use registry references for digest transport; candidate cleanup is an independent maintenance concern.
- [Concurrent publication] → Serialize cooperating publishers and verify digest equality after writes; document external registry writers as a limitation.
- [Pending OpenSpec overlap] → Reconcile `implement-mail-service`'s old GHCR publication requirement before archiving. Preserve unrelated container/runtime requirements and scenarios.

## Migration Plan

1. Implement and test the action and native matrix together, retaining the current image path and literal v* version tag convention.
2. Merge workflows to main and wait for the first verified amd64/arm64 SHA index before creating a version tag. Older pre-migration SHA images may remain amd64-only; new main publications must satisfy the dual-platform contract.
3. Verify a real v* tag promotion shares the saved digest. Do not claim registry success from local tests alone.
4. Roll back workflow changes if necessary; existing version images remain usable by digest. Do not move an existing release tag to a different digest.
5. Later copy the self-contained action directory into its own repository, publish/pin its revision, and change consumers' `uses:` references. No action input or build-side mapping change is required.
