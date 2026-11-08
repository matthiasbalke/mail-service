#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/registry.sh"
validate_image "${IMAGE:-}"
validate_sha "${SOURCE_SHA:-}"
validate_tag "${DESTINATION_TAG:-}"
source_ref="$IMAGE:sha-$SOURCE_SHA"
source_manifest=$(inspect_image "$source_ref")
[[ $source_manifest != null ]] || fail "Missing verified source $source_ref. Complete main publication, then rerun promotion."
digest=$(jq -r '.digest' <<<"$source_manifest")
destination="$IMAGE:$DESTINATION_TAG"
existing=$(inspect_image "$destination")
if [[ $existing != null ]]; then
  [[ $(jq -r '.digest' <<<"$existing") == "$digest" ]] || fail "Conflicting destination $destination; refusing to replace its digest."
  printf 'Already promoted: %s\n' "$destination"
else
  copy_image "$IMAGE@$digest" "$destination" "$digest"
fi
printf 'Promoted %s -> %s\n' "$IMAGE@$digest" "$destination"
if [[ -n ${GITHUB_OUTPUT:-} ]]; then
  printf 'digest=%s\nimage=%s@%s\n' "$digest" "$IMAGE" "$digest" >>"$GITHUB_OUTPUT"
fi
if [[ -n ${GITHUB_STEP_SUMMARY:-} ]]; then
  printf '### Image promotion\n\n- Destination: `%s`\n- Source: `%s`\n- Digest: `%s`\n' "$destination" "$source_ref" "$digest" >>"$GITHUB_STEP_SUMMARY"
fi
