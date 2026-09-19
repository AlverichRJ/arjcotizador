#!/usr/bin/env bash
# =============================================================================
# Instala el cotizador en el VPS que ya sirve alverichrj.tech.
# Se ejecuta como root, desde /root, con los archivos de deploy/ al lado:
#
#   CLAVE='la-contraseña' bash instalar.sh
#
# Da por hecho lo que setup-vps.sh del sitio ya dejó puesto: usuario deploy,
# Node 22, pnpm y Caddy.
# =============================================================================
set -euo pipefail

CLAVE="${CLAVE:?Falta CLAVE. Ej: CLAVE='...' bash instalar.sh}"
DOMINIO="${DOMINIO:-cotizador.alverichrj.tech}"
DIR_APP="/srv/arjcotizador"
DIR_DATOS="/var/lib/arjcotizador"

echo "==> Directorios"
install -d -o deploy -g deploy "$DIR_APP"
install -d -o deploy -g deploy -m 750 "$DIR_DATOS"
install -d -o deploy -g deploy -m 750 "$DIR_DATOS/imagenes"

echo "==> Servicio"
install -m 644 "$(dirname "$0")/arjcotizador.service" /etc/systemd/system/arjcotizador.service
systemctl daemon-reload
systemctl enable arjcotizador

echo "==> Caddy"
HASH="$(caddy hash-password --plaintext "$CLAVE")"
FRAGMENTO=/etc/caddy/cotizador.caddy
sed "s|{{HASH}}|${HASH}|; s|cotizador.alverichrj.tech|${DOMINIO}|" \
  "$(dirname "$0")/Caddyfile.fragmento" > "$FRAGMENTO"
chmod 600 "$FRAGMENTO"

# Se importa desde el Caddyfile principal en vez de pegarlo dentro: así el
# hash de la contraseña vive en un archivo aparte, con permisos 600.
if ! grep -q 'cotizador.caddy' /etc/caddy/Caddyfile; then
  printf '\nimport /etc/caddy/cotizador.caddy\n' >> /etc/caddy/Caddyfile
fi

caddy validate --config /etc/caddy/Caddyfile
chown -R caddy:caddy /var/log/caddy
systemctl reload caddy

echo "==> Respaldo diario de la base"
cat >/etc/cron.daily/arjcotizador-respaldo <<'EOF'
#!/bin/sh
# Copia consistente de la base (no un cp, que puede pillarla a medio escribir)
# y borrado de las de hace más de 30 días.
set -e
DIR=/var/lib/arjcotizador/respaldos
mkdir -p "$DIR"
sqlite3 /var/lib/arjcotizador/cotizador.db ".backup '$DIR/cotizador-$(date +%F).db'"
find "$DIR" -name 'cotizador-*.db' -mtime +30 -delete
EOF
chmod 755 /etc/cron.daily/arjcotizador-respaldo
apt-get install -y -qq sqlite3

cat <<EOF

─────────────────────────────────────────────────────────────
Instalado. Falta:

1. El registro A de ${DOMINIO} apuntando a este VPS.
   Sin eso Caddy no puede emitir el certificado.

2. Subir la aplicación construida a ${DIR_APP} y arrancar:
     systemctl start arjcotizador
     systemctl status arjcotizador

3. Entrar a https://${DOMINIO} — usuario: alberto
─────────────────────────────────────────────────────────────
EOF
