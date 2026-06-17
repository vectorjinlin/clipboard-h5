#!/usr/bin/env bash
# Commit + push tracked changes, then rsync server.js/package.json/public/ to the
# production host and restart the systemd service.
#
# Usage: ./deploy.sh "commit message"
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

SSH_KEY="${DEPLOY_SSH_KEY:-$HOME/.ssh/claude_key}"
HOST="${DEPLOY_HOST:-root@188.166.242.206}"
REMOTE_DIR="${DEPLOY_DIR:-/opt/clipboard-h5}"
SERVICE="${DEPLOY_SERVICE:-clipboard-h5}"
SITE_URL="${DEPLOY_URL:-https://clipboard.947sh.xyz/}"

if [[ -n "$(git status --porcelain -- server.js package.json public/)" ]]; then
  git add server.js package.json public/
  git commit -m "${1:-Deploy update}"
  git push origin main
else
  echo "No tracked changes to commit, syncing current state."
fi

rsync -avz -e "ssh -i $SSH_KEY" server.js package.json "$HOST:$REMOTE_DIR/"
rsync -avz -e "ssh -i $SSH_KEY" --delete public/ "$HOST:$REMOTE_DIR/public/"

ssh -i "$SSH_KEY" "$HOST" "systemctl restart $SERVICE && sleep 1 && systemctl is-active $SERVICE"

code=$(ssh -i "$SSH_KEY" "$HOST" "curl -s -o /dev/null -w '%{http_code}' $SITE_URL")
echo "Health check: $SITE_URL -> $code"
