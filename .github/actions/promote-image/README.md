# Promote an existing image

This composite action resolves `IMAGE:sha-<full commit SHA>` and assigns its exact digest to one Docker tag in the same repository. It never builds, selects latest, filters platforms, or modifies attestations. Existing destinations succeed as a no-op when their digest matches; conflicts fail without overwriting.

Inputs: `image` (lowercase registry/repository, no tag/digest), `source-sha` (40 lowercase hex characters), and `destination-tag` (one Docker tag). Outputs: `digest` and `image` (digest-qualified reference). Docker-compatible registry ports are supported, for example `localhost:5000/example/image`.

Use a Linux runner with Bash, jq, and Docker Buildx, log in first, and grant the caller package-write access. GHCR callers normally use `contents: read` and `packages: write` with `GITHUB_TOKEN`; the package must allow this repository access. The action does not receive credentials or perform login.

```yaml
permissions:
  contents: read
  packages: write
# At job level, serialize every writer for the same image and destination.
concurrency:
  group: promote-${{ github.repository }}-${{ github.ref_name }}
  cancel-in-progress: false
steps:
  - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262
  - uses: docker/setup-buildx-action@8d2750c68a42422c14e847fe6c8ac0403b4cbd6f
  - uses: docker/login-action@c94ce9fb468520275223c153574b00df6fe4bcc9
    with:
      registry: ghcr.io
      username: ${{ github.actor }}
      password: ${{ secrets.GITHUB_TOKEN }}
  - uses: ./.github/actions/promote-image
    id: promote
    with:
      image: ghcr.io/example/image
      source-sha: ${{ steps.release.outputs.sha }}
      destination-tag: ${{ github.ref_name }}
```

The caller must resolve and validate the release commit (`steps.release` above); event handling and SemVer policy intentionally live outside this action. See mail-service's `promote-images.yaml` for a complete caller. Keep verified `sha-*` tags for as long as releases may refer to them, and do not overwrite them. Missing sources fail: wait for successful main publication, then rerun the promotion job.

All cooperating callers must serialize on the same image/destination. This check-then-copy operation cannot protect against an independent registry writer racing it; the registry provides no compare-and-swap guarantee. Digest equality is checked after copying.

To extract later, copy this directory intact into the root of a dedicated action repository, including its scripts and tests. Change `uses: ./.github/actions/promote-image` to `uses: owner/promote-image@<full-commit-sha>`; inputs, outputs, authentication, and the build-side SHA mapping stay the same. `github.action_path` locates scripts independently of the caller workspace. No Bun, Node, mail-service files, or third-party libraries are needed by the action.

Tests (Python 3 is only a test dependency):

```sh
python3 .github/actions/promote-image/tests/test_promote.py
# Docker daemon, Buildx, and registry:2 required; only disposable local registry writes.
python3 .github/actions/promote-image/tests/test_registry.py
```
