#!/usr/bin/env bash
# Unset NODE_ENV to prevent Electron's production env from leaking into next dev
unset NODE_ENV
exec npm run dev
