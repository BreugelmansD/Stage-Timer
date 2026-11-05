#!/bin/bash
# ============================================================
#  Stage Timer starten
#  Andere poort nodig? Pas het getal hieronder aan (bv. 8080).
#  Pincode voor de bediening? Vul PIN in (leeg = geen pincode).
# ============================================================
PORT=3000
PIN=

cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is niet geïnstalleerd. Download het via https://nodejs.org"
  read -r -p "Druk op Enter om te sluiten"
  exit 1
fi
(sleep 1 && open "http://localhost:${PORT}/") &
if [ -n "$PIN" ]; then
  node server.js --port "$PORT" --pin "$PIN"
else
  node server.js --port "$PORT"
fi
