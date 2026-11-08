# Proposal

## Why

Mail-service currently rebuilds images on version tags and publishes only amd64. Releases should reuse an already validated image digest, with native amd64 and arm64 builds, and promotion logic should be reusable by other repositories.

## What Changes

- Build and smoke-test native amd64/arm64 candidates in a runner matrix, then publish one verified image index under `sha-<full commit SHA>` and `latest` on successful main builds.
- Add a self-contained composite promotion action in `.github/actions/promote-image` that resolves the saved commit image and copies its exact digest to a caller-specified Docker tag without rebuilding.
- Run a separate promotion workflow on unprefixed SemVer tag pushes such as `1.2.3`. Preserve the literal version tag and fail when its commit has no verified image.
- **BREAKING**: Version tags no longer initiate builds. Release commits must first complete main publication; version tags cannot overwrite a different published digest.
- Document the two-workflow contract, native runner requirements, and later extraction of the action to its own repository.

## Capabilities

### New Capabilities

- `image-promotion`: Portable action contract, commit-to-digest lookup, digest-preserving promotion, and release conflict handling.

### Modified Capabilities

- `container-distribution`: Extend the verified initial baseline with native multi-platform builds and replace its GHCR publication requirement with main-build publication and unprefixed SemVer tag promotion. Preserve unrelated container/runtime requirements.

## Impact

Changes affect `.github/workflows/ci.yaml`, a new promotion workflow, `.github/actions/promote-image`, workflow/action tests, and `docs/examples.md`. Existing Dockerfile and smoke tests will be exercised on both native architectures. Registry storage retains the commit-to-digest mapping; no artifact retention, external database, new registry service, or application runtime change is required. The action starts here; moving it later changes the caller's `uses:` reference. The katzenwanderweg repository is inspected as a reference and is not modified.
