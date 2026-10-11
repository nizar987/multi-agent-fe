#!/usr/bin/env bash
# Unset NODE_ENV to prevent Electron's production env from leaking into next dev
unset NODE_ENV

# Load nvm if available
export NVM_DIR="$HOME/.nvm"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  \. "$NVM_DIR/nvm.sh"
  nvm use 24 2>/dev/null || true
fi

exec npm run dev
