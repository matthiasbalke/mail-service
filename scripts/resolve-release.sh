#!/usr/bin/env bash
set -euo pipefail
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
tag=${RELEASE_TAG:-}
number='(0|[1-9][0-9]*)'
identifier='(0|[1-9][0-9]*|[0-9]*[a-zA-Z-][0-9a-zA-Z-]*)'
[[ $tag =~ ^$number\.$number\.$number(-$identifier(\.$identifier)*)?$ && ${#tag} -le 128 ]] ||
  fail 'Expected unprefixed SemVer, e.g. 1.2.3 or 1.2.3-rc.1; build metadata (+...) is not valid in Docker tags.'
[[ ${GITHUB_EVENT_NAME:-} == push && ${GITHUB_REF:-} == "refs/tags/$tag" &&
   ${GITHUB_SHA:-} =~ ^[a-f0-9]{40}$ ]] || fail 'Expected a matching tag-push event.'
# Use the caller token for private repositories without persisting credentials.
git -c credential.helper= -c 'credential.helper=!gh auth git-credential' fetch --no-tags origin "refs/tags/$tag" >&2
sha=$(git rev-parse --verify --end-of-options 'FETCH_HEAD^{commit}')
[[ $sha == "$GITHUB_SHA" ]] || fail 'Release tag commit differs from the event commit; the tag may have moved.'
printf 'Resolved %s to %s\n' "$tag" "$sha"
if [[ -n ${GITHUB_OUTPUT:-} ]]; then
  printf 'sha=%s\n' "$sha" >>"$GITHUB_OUTPUT"
fi
