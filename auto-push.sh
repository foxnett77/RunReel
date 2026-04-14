#!/usr/bin/env bash
# auto-push.sh — sincronizza Replit → GitHub ogni volta che ci sono commit nuovi
# Viene eseguito come workflow in background; si riavvia automaticamente.

if [ -z "$GITHUB_TOKEN" ]; then
  echo "[auto-push] GITHUB_TOKEN non impostato — uscita."
  exit 0
fi

REMOTE="https://foxnett77:${GITHUB_TOKEN}@github.com/foxnett77/RunReel.git"
INTERVAL=60  # secondi tra un controllo e l'altro

echo "[auto-push] Avviato. Controllo ogni ${INTERVAL}s."

while true; do
  # Recupera lo stato del remote senza modificare il working tree
  REMOTE_SHA=$(git ls-remote "$REMOTE" refs/heads/main 2>/dev/null | awk '{print $1}')
  LOCAL_SHA=$(git rev-parse HEAD 2>/dev/null)

  if [ -z "$REMOTE_SHA" ] || [ "$LOCAL_SHA" != "$REMOTE_SHA" ]; then
    echo "[auto-push] $(date '+%H:%M:%S') — push in corso…"
    git push "$REMOTE" HEAD:main --force 2>&1 \
      | sed "s/${GITHUB_TOKEN}/****/g" \
      | grep -v "^$" || true
    echo "[auto-push] fatto."
  fi

  sleep "$INTERVAL"
done
