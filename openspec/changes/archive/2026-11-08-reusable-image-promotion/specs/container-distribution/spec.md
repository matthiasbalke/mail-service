# Spec Delta

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
A separate workflow SHALL promote images on unprefixed SemVer Git tag pushes using the tag's peeled commit and literal tag name. It SHALL use the reusable action and SHALL not rebuild images or update latest. Published release events alone SHALL not trigger promotion. Promotion jobs SHALL have contents read and packages write permissions and serialize by image and destination tag.

#### Scenario: Lightweight or annotated version tag
- **WHEN** a lightweight or annotated 1.2.3 tag is pushed for a previously published commit
- **THEN** the workflow resolves the commit and promotes its saved image digest to 1.2.3 without changing latest

#### Scenario: Version tag precedes successful build
- **WHEN** an unprefixed SemVer tag points at a commit with no verified SHA image, including a main build still in progress
- **THEN** promotion fails with guidance to complete main publication and rerun promotion

#### Scenario: Unrelated event
- **WHEN** a non-version tag or v-prefixed tag is pushed, a pull request runs, or a GitHub release is published without a new matching tag push
- **THEN** no image promotion occurs

### Requirement: Release version validation
The promotion workflow SHALL validate canonical unprefixed SemVer before registry writes, accepting MAJOR.MINOR.PATCH and valid prerelease identifiers. It SHALL reject v-prefixed tags, malformed versions, numeric identifiers with leading zeroes, and build metadata containing `+`, which Docker tags cannot preserve. The reusable action SHALL remain usable with arbitrary valid Docker destination tags.

#### Scenario: Prerelease version
- **WHEN** the tag `1.2.3-rc.1` is pushed for a verified commit
- **THEN** promotion preserves `1.2.3-rc.1` as the destination Docker tag

#### Scenario: Invalid or incompatible version
- **WHEN** a tag such as `v1.2.3`, `01.2.3`, `1.2.3-01`, or `1.2.3+build.1` is considered for promotion
- **THEN** no destination image is written, and versions reaching workflow validation fail with a clear diagnostic

### Requirement: Publication operating instructions
Documentation SHALL explain native runner selection, SHA mapping retention, literal version tag promotion, required token permissions, missing-build recovery, and using or extracting the reusable action. It SHALL distinguish successful validation from confirmed registry publication.

#### Scenario: Follow release instructions
- **WHEN** a maintainer follows the documented release procedure
- **THEN** they wait for successful main publication, push an unprefixed SemVer tag for that commit, and verify the release tag shares its saved digest

## MODIFIED Requirements

### Requirement: GHCR publication
GitHub Actions SHALL build and publish verified images to `ghcr.io/<lowercase-owner>/<lowercase-repository>` after successful default-branch validation, using commit-specific and latest tags. Unprefixed SemVer tag pushes SHALL promote an existing verified commit digest to the literal version tag without rebuilding or updating latest. Publishing SHALL use the workflow token with package write permission.

#### Scenario: Publish default branch
- **WHEN** a default-branch push passes required validation on both native architectures
- **THEN** its verified image index is published with a commit-specific tag and latest is updated only when the commit is still main HEAD

#### Scenario: Publish release tag
- **WHEN** an unprefixed SemVer tag points at a commit with an existing verified SHA image
- **THEN** that image digest is promoted to the literal version tag without rebuilding or modifying the SHA tag or latest

#### Scenario: Failed validation
- **WHEN** a required validation step fails
- **THEN** no verified SHA or latest image is published for that workflow run and no release promotion can use its unverified candidates
