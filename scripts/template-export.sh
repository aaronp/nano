#!/usr/bin/env bash
# Mirrors templates/nano-template into another repository's main branch as one commit:
#   scripts/template-export.sh <remote-url>
# Files deleted here are deleted there; node_modules and dist are never exported. Nothing changed: nothing pushed.
# Never force-pushes: if the remote moved on, the push fails and nothing is overwritten.
set -euo pipefail
remote="${1:?usage: scripts/template-export.sh <remote-url>}"
root="$(cd "$(dirname "$0")/.." && pwd)"
sha="$(git -C "$root" rev-parse --short HEAD)"
work="$(mktemp -d "${TMPDIR:-/tmp}/nano-template-export.XXXXXX")"

git clone --quiet "$remote" "$work"
cd "$work"
git rev-parse --verify --quiet HEAD >/dev/null || git checkout --quiet -b main   # an empty repository
[ "$(git rev-parse --abbrev-ref HEAD)" = main ] || git checkout --quiet main

rsync -a --delete --exclude .git --exclude node_modules --exclude dist "$root/templates/nano-template/" "$work/"
if [ -z "$(git status --porcelain)" ]; then echo "nano-template is up to date with aaronp/nano@$sha; nothing to export"; exit 0; fi

git add -A
git commit --quiet -m "Export from aaronp/nano@$sha"
git push --quiet origin main
echo "exported aaronp/nano@$sha to $remote"
