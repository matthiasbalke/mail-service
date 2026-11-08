# Spec Delta

## Purpose

Distribute validated native amd64 and arm64 images through a shared GHCR image index, separating main builds from digest-preserving version promotion.

## ADDED Requirements

### Requirement: Native platform verification
The build workflow SHALL build and smoke-test Linux amd64 and arm64 images in a matrix on native runners for their respective architectures, without CPU emulation. Pull requests SHALL run validation without publishing to GHCR. Required application checks SHALL gate publication.

#### Scenario: Native matrix build
- **WHEN** a pull request or main push starts validation
- **THEN** amd64 runs on an amd64 runner and arm64 on an arm64 runner, and both execute image runtime, TLS delivery, shutdown, and non-root smoke checks

#### Scenario: Failed platform verification
- **WHEN** either architecture fails validation or a required application check fails
- **THEN** no verified SHA image or latest tag is published for that commit

### Requirement: Verified multi-platform publication
Successful main builds SHALL publish one index containing the exact tested amd64 and arm64 images under `ghcr.io/<lowercase-owner>/<lowercase-repository>:sha-<full commit SHA>`. The registry tag SHALL persist the commit-to-digest mapping. Successful publication SHALL also update latest. Existing SHA tags SHALL be reused rather than replaced by a rebuilt digest.

#### Scenario: Publish verified index
- **WHEN** both native candidate images and required checks succeed for a main commit
- **THEN** the SHA tag resolves to an index containing those exact candidate digests and latest references that index

#### Scenario: Repeat main build
- **WHEN** a verified SHA tag already exists for a main commit
- **THEN** its existing digest remains unchanged

### Requirement: Version tag promotion workflow
A separate workflow SHALL promote images on `v*` Git tag pushes using the tag's peeled commit and literal tag name. It SHALL use the reusable action and SHALL not rebuild images or update latest. Published release events alone SHALL not trigger promotion. Promotion jobs SHALL have contents read and packages write permissions and serialize by image and destination tag.

#### Scenario: Lightweight or annotated version tag
- **WHEN** a lightweight or annotated v1.2.3 tag is pushed for a previously published commit
- **THEN** the workflow resolves the commit and promotes its saved image digest to v1.2.3 without changing latest

#### Scenario: Version tag precedes successful build
- **WHEN** a v* tag points at a commit with no verified SHA image, including a main build still in progress
- **THEN** promotion fails with guidance to complete main publication and rerun promotion

#### Scenario: Unrelated event
- **WHEN** a non-v* tag is pushed, a pull request runs, or a GitHub release is published without a new matching tag push
- **THEN** no promotion is triggered

### Requirement: Publication operating instructions
Documentation SHALL explain native runner selection, SHA mapping retention, literal version tag promotion, required token permissions, missing-build recovery, and using or extracting the reusable action. It SHALL distinguish successful validation from confirmed registry publication.

#### Scenario: Follow release instructions
- **WHEN** a maintainer follows the documented release procedure
- **THEN** they wait for successful main publication, push a v* tag for that commit, and verify the release tag shares its saved digest
