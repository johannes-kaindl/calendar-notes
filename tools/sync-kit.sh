#!/bin/sh
# Wrapper: das Vendoring liegt zentral im Dach (tools/kit-sync/, README dort), Konfiguration in tools/kit-sync.json.
# Nie von Hand editieren — Pins stehen in der Konfig, nicht hier.
set -e
[ -f ../tools/kit-sync/kit-sync.mjs ] || { echo "FEHLER: ../tools/kit-sync/kit-sync.mjs fehlt (Dach-Werkzeug)." >&2; exit 2; }
exec node ../tools/kit-sync/kit-sync.mjs "$@"
