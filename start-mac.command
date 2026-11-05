#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is niet geïnstalleerd. Download het via https://nodejs.org"
  read -r -p "Druk op Enter om te sluiten"
  exit 1
fi
(sleep 1 && open "http://localhost:${PORT:-3000}/") &
node server.js
