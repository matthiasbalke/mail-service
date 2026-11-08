# Tasks

## 1. Reusable promotion action

- [x] 1.1 Add a self-contained composite action in `.github/actions/promote-image` with image/source-sha/destination-tag inputs and digest/image outputs, using action-relative paths and caller-provided registry login; verify metadata and execution from a workspace containing no mail-service application files.
- [x] 1.2 Implement validated commit-tag lookup, digest-qualified copy, same-digest no-op, conflicting-digest rejection, and post-copy equality checks; test invalid inputs, absent source/destination, auth/network failures, conflicts, and retries using a controlled Docker command fixture.
- [x] 1.3 Verify real digest preservation using a disposable local registry with a single-platform manifest and an index containing amd64/arm64 and attestation descriptors; confirm no manifest rewriting or platform filtering and that failures do not overwrite existing release tags.
- [x] 1.4 Document prerequisites, caller login/permissions, inputs/outputs, SHA-tag retention, caller concurrency, and local versus remote uses examples inside the action directory; verify the directory can be copied intact to a standalone action repository.

## 2. Native image build and publication

- [x] 2.1 Refactor CI to PR/main builds with explicit amd64/ubuntu-24.04 and arm64/ubuntu-24.04-arm matrix entries, isolated architecture caches, and no QEMU; retain required application and Compose checks and verify workflow validation rejects publication on PR events.
- [x] 2.2 Build and smoke-test native local images for PRs and exact pushed candidate digests for trusted main builds, using run/attempt/architecture-specific candidate tags; verify both architectures run existing TLS, runtime identity, and shutdown checks without a second publication build.
- [x] 2.3 Add a publication job gated on all checks and native jobs that combines exact candidates into a verified index, validates amd64/arm64 descriptors, and writes SHA/latest with publication serialization; verify a failed platform cannot publish verified tags, a retry preserves an existing verified SHA digest, and stale main runs cannot regress latest.
- [x] 2.4 Update build/publication documentation in `docs/examples.md` for native platforms, candidate versus verified tags, permissions, caches, and retention; verify its image names and conditions match the workflow.

## 3. Tag-triggered release promotion

- [x] 3.1 Add the unprefixed SemVer tag-push promotion workflow with a numeric glob and strict version validation with trusted main automation checkout, explicit tag fetch and commit peeling, moved-tag detection, contents read/packages write permissions, and destination-specific concurrency; verify lightweight and annotated tags resolve correctly and unrelated/release-only events do not promote, valid `1.2.3` and `1.2.3-rc.1` tags work, and v-prefixed tags, leading-zero versions, malformed candidates, and build metadata cannot promote.
- [x] 3.2 Invoke the action with the tagged commit and literal unprefixed SemVer Docker tag after Buildx setup and registry login; verify no build command or latest mutation occurs, missing sources fail with rerun guidance, repeat promotion is a no-op, and conflicting destinations fail.
- [x] 3.3 Document waiting for main publication, pushing a version tag, checking digest equality, recovering from premature tagging, and extracting the action later; validate examples against action inputs and workflow triggers.

## 4. Integration verification

- [x] 4.1 Run action tests, local-registry promotion checks, workflow validation, type checking, and existing application tests; record results and explicitly distinguish local validation from native GitHub runner execution and GHCR publication.
- [x] 4.2 Verify the complete build-to-promotion contract with controlled native-candidate references and lightweight/annotated tag fixtures; confirm only the final verified SHA index is eligible for release promotion and both platform digests survive unchanged.

## Workflow follow-up

- When syncing this change, apply its explicit GHCR publication modification to the archived initial baseline and preserve unrelated runtime/deployment requirements and scenarios.
- After merge, observe successful real amd64/arm64 main publication before creating a release tag, then verify its GHCR destination digest. Do not create release tags solely as a local test or claim remote success without run evidence.
- Move the action to its own repository later by copying the self-contained directory and updating pinned uses references; this repository creation is outside the current change.
