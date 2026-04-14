#!/usr/bin/env bash
set -e

if [ -z "$GITHUB_TOKEN" ]; then
  echo "GITHUB_TOKEN non impostato, skip push."
  exit 0
fi

REMOTE_URL="https://foxnett77:${GITHUB_TOKEN}@github.com/foxnett77/RunReel.git"

git config user.email "foxnett@gmail.com" 2>/dev/null || true
git config user.name  "foxnett77"         2>/dev/null || true

# Fetch latest state from origin before pushing
git fetch "$REMOTE_URL" main 2>/dev/null || true

# Force push — Replit è la source-of-truth
git push "$REMOTE_URL" HEAD:main --force 2>&1 | sed "s/${GITHUB_TOKEN}/****/g" || true

echo "Push completato."
