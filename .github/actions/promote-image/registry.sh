#!/usr/bin/env bash
# Shared by the action and its caller's publication script. No login or event logic.
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

validate_image() {
  # Explicit registry/repository, optional registry port; no credentials, tags or digests.
  [[ ${1:-} =~ ^[a-z0-9]+([.-][a-z0-9]+)*(:[0-9]+)?/([a-z0-9]+([._-][a-z0-9]+)*/)*[a-z0-9]+([._-][a-z0-9]+)*$ ]] || fail 'Expected a lowercase registry/repository without tag or digest.'
}
validate_sha() { [[ ${1:-} =~ ^[a-f0-9]{40}$ ]] || fail 'Expected a full lowercase 40-character commit SHA.'; }
validate_tag() { [[ ${1:-} =~ ^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$ ]] || fail 'Invalid destination Docker tag.'; }

# Return JSON null only for an explicit missing manifest. Never confuse denial with absence.
inspect_image() {
  local reference=$1 result errors
  errors=$(mktemp)
  if result=$(docker buildx imagetools inspect "$reference" --format '{{json .Manifest}}' 2>"$errors"); then
    rm -f "$errors"
    jq -e 'type == "object" and (.digest | type == "string" and test("^sha256:[a-f0-9]{64}$")) and
      (.mediaType == "application/vnd.oci.image.index.v1+json" or
       .mediaType == "application/vnd.docker.distribution.manifest.list.v2+json" or
       .mediaType == "application/vnd.oci.image.manifest.v1+json" or
       .mediaType == "application/vnd.docker.distribution.manifest.v2+json")' <<<"$result" >/dev/null || fail "Invalid manifest for $reference."
    printf '%s\n' "$result"
  else
    result=$(cat "$errors")
    rm -f "$errors"
    if [[ ! ${result,,} =~ unauthorized|denied|forbidden|timeout|deadline|connection ]] &&
       [[ ${result,,} =~ manifest[[:space:]_]unknown|:[[:space:]]not[[:space:]]found ]]; then
      printf 'null\n'
    else
      fail "Cannot inspect $reference; check registry authentication, connectivity and Buildx."
    fi
  fi
}

copy_image() {
  local source=$1 destination=$2 expected=$3 actual
  docker buildx imagetools create --prefer-index=false --tag "$destination" "$source"
  actual=$(inspect_image "$destination")
  [[ $(jq -r '.digest' <<<"$actual") == "$expected" ]] || fail "Digest mismatch after writing $destination."
}
