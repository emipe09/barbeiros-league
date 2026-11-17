#!/usr/bin/env bash
# Abre o painel da Barbeiros League: inicia o servidor e o navegador.
cd "$(dirname "$0")"
( sleep 1.5; xdg-open "http://localhost:${PORT:-3000}/#/admin" >/dev/null 2>&1 || true ) &
exec npm start
