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
sudo systemctl is-active --quiet arjcotizador || {
  echo "!! El servicio no levantó. Mira: journalctl -u arjcotizador -n 40" >&2
  exit 1
}

echo "==> Listo. Comprueba EN LA URL: https://cotizador.alverichrj.tech"
