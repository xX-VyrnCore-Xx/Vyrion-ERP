#!/usr/bin/env bash
# Delete the GitHub releases and git tags that fall outside the newest $KEEP.
#
# Environment:
#   KEEP         releases to keep                       (default 3)
#   DRY_RUN      "true" only prints the plan            (default true)
#   CURRENT_TAG  tag just released; if it would not survive, nothing is deleted
#   GH_TOKEN / GH_REPO  consumed by the gh CLI
#
# Run from inside a clone that has all tags fetched.
set -euo pipefail

KEEP="${KEEP:-3}"
DRY_RUN="${DRY_RUN:-true}"
CURRENT_TAG="${CURRENT_TAG:-}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

args=(--keep "$KEEP")
if [ -n "$CURRENT_TAG" ]; then
  args+=(--must-keep "$CURRENT_TAG")
fi

status=0
plan="$(git tag --list | python3 "$here/prune_tags.py" "${args[@]}")" || status=$?
case "$status" in
  0) ;;
  3)
    echo "::warning::$CURRENT_TAG is not among the newest $KEEP releases: pruning skipped."
    exit 0
    ;;
  *) exit "$status" ;;
esac

if [ -z "$plan" ]; then
  echo "Nothing to prune."
  exit 0
fi

while IFS= read -r tag; do
  [ -n "$tag" ] || continue
  if [ "$DRY_RUN" = "true" ]; then
    echo "[dry-run] would delete release and tag $tag"
    continue
  fi

  if view_error="$(gh release view "$tag" 2>&1 >/dev/null)"; then
    echo "Deleting release and tag $tag"
    gh release delete "$tag" --cleanup-tag --yes
  elif [[ "$view_error" == *"release not found"* ]]; then
    echo "No release for $tag: deleting the tag only"
    git push origin --delete "refs/tags/$tag"
  else
    # Unknown failure (network, permissions): do not guess and do not delete.
    echo "::error::cannot inspect release $tag: $view_error"
    exit 1
  fi
done <<<"$plan"
