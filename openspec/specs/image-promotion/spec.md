# image-promotion Specification

## Purpose

Allow repositories to promote a previously published commit image to an explicit release tag while preserving its exact digest and avoiding release-time rebuilds.

## Requirements

### Requirement: Portable action interface
The action SHALL accept an image repository, full source commit SHA, and destination Docker tag, and SHALL return the promoted digest and digest-qualified image reference. It SHALL use the caller's registry authentication and SHALL not depend on mail-service files, repository names, or event payloads.

#### Scenario: Use in another repository
- **WHEN** a caller invokes the action with its own image, source SHA, and release tag after registry login
- **THEN** promotion uses those values without mail-service configuration or application dependencies

#### Scenario: Invalid inputs
- **WHEN** an input is missing or malformed, including a shortened commit SHA or invalid Docker tag
- **THEN** the action fails before any registry write

### Requirement: Saved commit image lookup
The action SHALL resolve `<image>:sha-<full commit SHA>` to a valid image digest and use `<image>@<digest>` for promotion. A missing source or registry access failure SHALL fail without building an image, selecting latest, or writing a destination tag.

#### Scenario: Promote an older commit
- **WHEN** a version tag identifies a previously published commit that is no longer main HEAD
- **THEN** promotion uses that commit's saved image digest rather than the current latest image

#### Scenario: Source unavailable
- **WHEN** the source image is absent or cannot be read because of registry or authentication failure
- **THEN** promotion fails with a useful diagnostic and performs no build or destination write

### Requirement: Digest-preserving promotion
Promotion SHALL create the destination tag from the resolved digest without rebuilding or changing its manifest, supported platforms, or attestations. It SHALL verify the destination digest equals the source digest before reporting success, for both single-platform manifests and multi-platform indexes.

#### Scenario: Promote a multi-platform image
- **WHEN** the source contains amd64 and arm64 images and attestations
- **THEN** the release tag resolves to the identical index digest with all descriptors preserved

#### Scenario: Promote a single-platform image
- **WHEN** the source is a single-platform manifest
- **THEN** promotion preserves its digest without wrapping it in a new index

### Requirement: Release tag conflict handling
Promotion SHALL succeed without writing when the destination already has the source digest, and SHALL fail without replacing a destination with a different digest. Registry errors SHALL not be treated as an absent destination. Callers SHALL serialize promotions for the same image and release tag.

#### Scenario: Repeat promotion
- **WHEN** the same release promotion runs again and the destination digest matches
- **THEN** it succeeds as a no-op and returns the existing digest

#### Scenario: Conflicting release
- **WHEN** the destination tag points to a different digest
- **THEN** promotion fails and preserves the existing release image
