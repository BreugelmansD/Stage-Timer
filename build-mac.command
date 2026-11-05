#!/bin/bash
# ============================================================
#  Stage Timer – Mac-app bouwen
#  Dubbelklik op dit bestand (op een Mac met Node.js).
#  Resultaat: dist/Stage-Timer-mac.dmg
# ============================================================
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is niet geïnstalleerd. Download het via https://nodejs.org (LTS) en probeer opnieuw."
  read -r -p "Druk op Enter om te sluiten"
  exit 1
fi

echo "1/3  Onderdelen installeren…"
npm ci --no-audit --no-fund

echo "2/3  App bouwen (Apple Silicon + Intel)…"
CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist:mac

echo "3/3  DMG maken…"
rm -rf dist/dmg dist/Stage-Timer-mac.dmg
mkdir -p dist/dmg
cp -R "dist/mac-universal/Stage Timer.app" dist/dmg/
ln -s /Applications dist/dmg/Applications
hdiutil create -volname "Stage Timer" -srcfolder dist/dmg -ov -format UDZO dist/Stage-Timer-mac.dmg >/dev/null
rm -rf dist/dmg

echo ""
echo "Klaar: dist/Stage-Timer-mac.dmg"
open -R dist/Stage-Timer-mac.dmg
read -r -p "Druk op Enter om te sluiten"
