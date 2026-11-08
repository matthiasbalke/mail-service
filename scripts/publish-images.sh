#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/../.github/actions/promote-image/registry.sh"
validate_image "${IMAGE:-}"
validate_sha "${GITHUB_SHA:-}"
[[ ${GITHUB_EVENT_NAME:-} == push && ${GITHUB_REF:-} == refs/heads/main &&
   ${CHECKS_RESULT:-} == success && ${NATIVE_RESULT:-} == success ]] || fail 'Publication requires a main push and all checks/native jobs to succeed.'
[[ ${GITHUB_RUN_ID:-} =~ ^[0-9]+$ && ${GITHUB_RUN_ATTEMPT:-} =~ ^[0-9]+$ ]] || fail 'Missing run identity.'
[[ ${GITHUB_REPOSITORY:-} =~ ^[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+$ ]] || fail 'Invalid GitHub repository.'

validate_index() {
  jq -e '(.mediaType == "application/vnd.oci.image.index.v1+json" or
           .mediaType == "application/vnd.docker.distribution.manifest.list.v2+json") and
    ([.manifests[] | select(.platform.os == "linux") | .platform.architecture] | sort == ["amd64", "arm64"]) and
    all(.manifests[]; (.digest | test("^sha256:[a-f0-9]{64}$")))' <<<"$1" >/dev/null || fail 'Expected exactly one linux/amd64 and one linux/arm64 image in the verified index.'
}

verified="$IMAGE:sha-$GITHUB_SHA"
manifest=$(inspect_image "$verified")
if [[ $manifest == null ]]; then
  sources=()
  expected='[]'
  for architecture in amd64 arm64; do
    candidate="$IMAGE:candidate-$GITHUB_SHA-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT-$architecture"
    part=$(inspect_image "$candidate")
    [[ $part != null ]] || fail "Missing native candidate $candidate."
    jq -e --arg arch "$architecture" '([.manifests[] | select(.platform.os == "linux") | .platform.architecture] == [$arch])' <<<"$part" >/dev/null || fail "Invalid $architecture candidate."
    sources+=("$IMAGE@$(jq -r '.digest' <<<"$part")")
    expected=$(jq -cn --argjson previous "$expected" --argjson part "$part" '$previous + $part.manifests')
  done
  # Inspect the assembled index before assigning any verified tag.
  combined=$(docker buildx imagetools create --dry-run "${sources[@]}")
  validate_index "$combined"
  jq -e --argjson expected "$expected" '(.manifests | sort_by(.digest)) == ($expected | sort_by(.digest))' <<<"$combined" >/dev/null || fail 'Assembly changed candidate descriptors.'
  docker buildx imagetools create --tag "$verified" "${sources[@]}"
  manifest=$(inspect_image "$verified")
  jq -e --argjson expected "$expected" '(.manifests | sort_by(.digest)) == ($expected | sort_by(.digest))' <<<"$manifest" >/dev/null || fail 'Published descriptors differ from tested candidates.'
fi
validate_index "$manifest"
digest=$(jq -r '.digest' <<<"$manifest")

# An older run may publish its own SHA, but must not move latest backwards.
main_sha=$(gh api "repos/$GITHUB_REPOSITORY/git/ref/heads/main" --jq .object.sha)
validate_sha "$main_sha"
if [[ $main_sha == "$GITHUB_SHA" ]]; then
  copy_image "$IMAGE@$digest" "$IMAGE:latest" "$digest"
else
  printf 'Skipping latest: this commit is no longer main HEAD.\n'
fi
printf 'Verified image: %s@%s\n' "$IMAGE" "$digest"
if [[ -n ${GITHUB_STEP_SUMMARY:-} ]]; then
  printf '### Verified native image\n\n- Commit: `%s`\n- Image: `%s@%s`\n- Platforms: linux/amd64, linux/arm64\n' "$GITHUB_SHA" "$IMAGE" "$digest" >>"$GITHUB_STEP_SUMMARY"
fi
