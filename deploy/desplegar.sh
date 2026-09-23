#!/usr/bin/env bash
# =============================================================================
# Publica la versión actual de main del cotizador.
# Se instala en el VPS como /usr/local/bin/cot-deploy.
#
# Desde tu PC:  git push && ssh deploy@IP cot-deploy
#
# El servicio se para solo el tiempo justo de intercambiar el build: si algo
# falla antes, la versión anterior sigue en pie y atendiendo.
# =============================================================================
set -euo pipefail

DIR="${DIR_APP:-/srv/arjcotizador}"
RAMA="${RAMA:-main}"

cd "$DIR"

echo "==> Trayendo $RAMA"
git fetch --prune origin
git checkout "$RAMA"
git reset --hard "origin/$RAMA"
echo "    $(git log -1 --pretty='%h %s')"

echo "==> Dependencias"
pnpm install --frozen-lockfile --prod=false

echo "==> Construyendo"
pnpm build

if [ ! -f "$DIR/dist/server/entry.mjs" ]; then
  echo "!! El build no generó dist/server/entry.mjs. No se reinicia nada." >&2
  exit 1
fi

echo "==> Reiniciando el servicio"
sudo systemctl restart arjcotizador
sleep 2
# sin sudo: consultar el estado no requiere privilegios, y pedirlos hacía que
# esta comprobación fallara siempre y diera un "no levantó" falso con el
# servicio corriendo perfectamente
systemctl is-active --quiet arjcotizador || {
  echo "!! El servicio no levantó. Mira: journalctl -u arjcotizador -n 40" >&2
  exit 1
}

echo "==> Comprobando que las páginas respondan"
# No basta con que el proceso arranque: un error al renderizar deja el servicio
# "activo" y la página se corta a media respuesta. Ya pasó — un import que
# faltaba tumbó el editor mientras el despliegue decía "listo".
DB="${DATOS_DIR:-/var/lib/arjcotizador}/cotizador.db"
ULTIMA="$(sqlite3 "$DB" 'SELECT id FROM cotizaciones ORDER BY id DESC LIMIT 1' 2>/dev/null || true)"

RUTAS="/"
if [ -n "$ULTIMA" ]; then
  RUTAS="$RUTAS /cotizacion/$ULTIMA /cotizacion/$ULTIMA/imprimir /cotizacion/$ULTIMA/compra"
fi

FALLOS=0
for RUTA in $RUTAS; do
  # --fail-with-body y -o /dev/null: interesa el código y que el cuerpo llegue
  # entero; una respuesta cortada da error de curl aunque el código sea 200.
  if CODIGO=$(curl -sS --fail --max-time 25 -o /dev/null -w '%{http_code}' \
      "http://127.0.0.1:${PORT:-4322}${RUTA}" 2>/dev/null); then
    echo "    ✓ ${RUTA} → ${CODIGO}"
  else
    echo "    ✗ ${RUTA} → respuesta incompleta o error" >&2
    FALLOS=$((FALLOS + 1))
  fi
done

if [ "$FALLOS" -gt 0 ]; then
  echo "!! $FALLOS página(s) fallan. Mira: journalctl -u arjcotizador -n 40" >&2
  exit 1
fi

echo "==> Listo. Comprueba EN LA URL: https://cotizador.alverichrj.tech"
