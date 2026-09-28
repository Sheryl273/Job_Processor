#!/usr/bin/env bash
# Usage: ./scripts/create-github-repo.sh <repo-name> [--public]
# Requires: git and GitHub CLI (gh auth login). Creates the repo, pushes main, and creates the dev branches.
set -euo pipefail
cd "$(dirname "$0")/.."
NAME="${1:?repo name required}"
VIS="${2:---private}"
[ -d .git ] || git init -b main
git add -A
git commit -m "chore: initial scaffold" || true
gh repo create "$NAME" "$VIS" --source=. --remote=origin --push
for b in feat/a-data feat/b-worker feat/c-api feat/d-dashboard; do
  git branch "$b" 2>/dev/null || true
  git push -u origin "$b"
done
echo "Now: add your 3 teammates as collaborators, and update .github/CODEOWNERS with their handles."
echo "Optional: protect main (Settings > Branches) to require PR + green CI."
