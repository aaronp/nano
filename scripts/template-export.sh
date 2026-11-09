#!/usr/bin/env bash
# Mirrors templates/nano-template into another repository's main branch as one commit:
#   scripts/template-export.sh <remote-url>          (DRY_RUN=1: show what would be exported, and push nothing)
# It exports the template as committed at HEAD. Files deleted here are deleted there. Nothing changed: nothing pushed.
# Never force-pushes: if the remote moved on, the push fails and nothing is overwritten.
set -euo pipefail
remote="${1:?usage: scripts/template-export.sh <remote-url>}"
root="$(cd "$(dirname "$0")/.." && pwd)"
sha="$(git -C "$root" rev-parse --short HEAD)"
work="$(mktemp -d "${TMPDIR:-/tmp}/nano-template-export.XXXXXX")"

git clone --quiet "$remote" "$work"
cd "$work"
# main as the remote has it, or a new main in an empty repository
if git rev-parse --quiet --verify origin/main >/dev/null; then git checkout --quiet -B main origin/main; else git checkout --quiet --orphan main; fi

# the committed template at HEAD, never the working tree (no uncommitted or untracked files)
stage="$(mktemp -d "${TMPDIR:-/tmp}/nano-template-stage.XXXXXX")"
git -C "$root" archive HEAD templates/nano-template | tar -x -C "$stage"
rsync -a --delete --exclude .git --exclude node_modules --exclude dist "$stage/templates/nano-template/" "$work/"
if [ -z "$(git status --porcelain)" ]; then echo "nano-template is up to date with aaronp/nano@$sha; nothing to export"; exit 0; fi

git add -A
git commit --quiet -m "Export from aaronp/nano@$sha"
if [ -n "${DRY_RUN:-}" ]; then git show --stat --format='would push: %s' HEAD; exit 0; fi
git push --quiet origin main
echo "exported aaronp/nano@$sha"   # (not the remote URL: it may carry a token)
