#!/usr/bin/env bash
# jsDelivr refuses GitHub versions over 50 MB: on those it answers 403 for about
# 6% of uncached requests, whichever file they ask for (main is 157 MB). The
# limit is per ref, so the pictures are served from branches that each stay
# under it. Paths are kept, and main stays the only place anyone edits:
#   cdn            every folder below, the site's pictures and their small indexes
#   cdn-full       operators/full/
#   cdn-potential  operators/potential/
# combat/, story/, wiki/, scripts/ and root files are data the site reads from
# raw.githubusercontent. Keep ItJustLogs' cdnRef() (src/domain/banners.ts) in step.
#
# Each branch is one parentless commit, force-pushed when its files change.
# Over 45 MB fails the run, so a branch gets split before jsDelivr notices.
set -euo pipefail

source=$(git rev-parse HEAD)
limit=$((45 * 1024 * 1024))
tab=$'\t'
index=$(mktemp -u)
trap 'rm -f "$index"' EXIT

publish() { # branch, then the paths on stdin as `git ls-tree -r` lines
  local branch=$1 tree size commit
  rm -f "$index"
  GIT_INDEX_FILE=$index git update-index --add --index-info
  tree=$(GIT_INDEX_FILE=$index git write-tree)
  size=$(git ls-tree -r -l "$tree" | awk '{ s += $4 } END { print s + 0 }')
  echo "$branch: $((size / 1048576)) MB"
  if [ "$size" -gt "$limit" ]; then
    echo "::error::$branch is over 45 MB: split it (here and in cdnRef)" >&2
    exit 1
  fi
  git fetch -q --depth=1 origin "+refs/heads/$branch:refs/remotes/origin/$branch" 2>/dev/null || true
  if [ "$(git rev-parse -q --verify "origin/$branch^{tree}" || true)" = "$tree" ]; then
    echo "  unchanged"
    return
  fi
  commit=$(git commit-tree "$tree" -m "Pictures from main ${source:0:7}")
  git push -q -f origin "$commit:refs/heads/$branch"
  echo "  pushed ${commit:0:7}"
}

files=$(git ls-tree -r "$source")
grep -E "${tab}operators/full/" <<<"$files" | publish cdn-full
grep -E "${tab}operators/potential/" <<<"$files" | publish cdn-potential
grep -E "${tab}[^/]+/" <<<"$files" |
  grep -vE "${tab}(combat|story|wiki|scripts|\.github|operators/full|operators/potential)/" |
  publish cdn
