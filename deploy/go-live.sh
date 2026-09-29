#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# adcrevia.com — one-shot go-live through the shared public nginx
# (schoolagam_nginx). Same safe order as medocks/scripts/go-live.sh:
#   1. DNS preflight: adcrevia.com and www must resolve to THIS server.
#   2. The app container must be running (./deploy/deploy.sh first).
#   3. Temporary HTTP-only vhost so certbot can solve the ACME HTTP-01 challenge.
#   4. Let's Encrypt cert via webroot (auto-renewed by certbot.timer; the
#      deploy hook in /etc/letsencrypt/renewal-hooks/deploy reloads nginx).
#   5. Swap in the full HTTPS vhost. Every reload is preceded by `nginx -t`,
#      so a mistake can never take the other sites down.
# Idempotent: safe to re-run. Run as root on the VPS.
# ---------------------------------------------------------------------------
set -euo pipefail

SERVER_IP="187.127.134.41"
DOMAIN="adcrevia.com"
WWW="www.adcrevia.com"
PROJECT_DIR="/var/www/adcrevia"
SHARED_NGINX_CONF_DIR="/var/www/schoolagam/nginx"   # = schoolagam_nginx:/etc/nginx/conf.d
NGINX_CONTAINER="schoolagam_nginx"
CERTBOT_WEBROOT="/var/www/certbot"
BOOTSTRAP_CONF="${SHARED_NGINX_CONF_DIR}/adcrevia-bootstrap.conf"
FINAL_CONF="${SHARED_NGINX_CONF_DIR}/adcrevia.conf"

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m❌ %s\033[0m\n' "$*" >&2; exit 1; }

nginx_test_and_reload() {
  docker exec "$NGINX_CONTAINER" nginx -t \
    || die "nginx config test FAILED — NOT reloading (live sites untouched)."
  docker exec "$NGINX_CONTAINER" nginx -s reload
}

# 1) DNS preflight ----------------------------------------------------------
# Queried at the domain's AUTHORITATIVE nameservers: that is what Let's Encrypt's
# own resolvers see. Public caches (8.8.8.8 etc.) can lag by the old TTL.
log "Checking DNS for ${DOMAIN} and ${WWW} (authoritative nameservers)"
auth_ns="$(dig +short NS "$DOMAIN" | sed 's/\.$//')"
[ -n "$auth_ns" ] || die "Could not look up the nameservers for ${DOMAIN}."
for name in "$DOMAIN" "$WWW"; do
  for ns in $auth_ns; do
    got="$(dig +short "$name" A @"$ns" | grep -E '^[0-9.]+$' | tail -1)"
    echo "   ${name} @${ns} -> ${got:-<none>}"
    [ "$got" = "$SERVER_IP" ] || die "${name} does not point to ${SERVER_IP} at ${ns}.
   Fix the A record for @ in Bluehost DNS, then re-run this script."
  done
done
for ns in 8.8.8.8 1.1.1.1; do
  echo "   (public cache @${ns}: ${DOMAIN} -> $(dig +short "$DOMAIN" A @"$ns" | tail -1); catches up within the old TTL)"
done

# 2) App must be up ---------------------------------------------------------
log "Checking the adcrevia app container"
cd "$PROJECT_DIR"
docker compose --env-file .env.production ps --status running --services | grep -qx app \
  || die "adcrevia app is not running. Run ./deploy/deploy.sh first."

# 3) Temporary HTTP vhost for the ACME challenge ---------------------------
if [ ! -d "/etc/letsencrypt/live/${DOMAIN}" ]; then
  log "Installing temporary HTTP vhost for ACME challenge"
  cat > "$BOOTSTRAP_CONF" <<CONF
server {
    listen 80;
    server_name ${DOMAIN} ${WWW};
    location /.well-known/acme-challenge/ { root ${CERTBOT_WEBROOT}; }
    location / { return 200 "adcrevia acme bootstrap\n"; }
}
CONF
  nginx_test_and_reload

  # 4) Obtain the certificate ----------------------------------------------
  log "Requesting Let's Encrypt certificate (webroot)"
  certbot certonly --webroot -w "$CERTBOT_WEBROOT" \
    -d "$DOMAIN" -d "$WWW" \
    --key-type ecdsa \
    --non-interactive --agree-tos --register-unsafely-without-email \
    || die "certbot failed. Temporary HTTP vhost left in place for retry."
else
  log "Certificate already exists for ${DOMAIN} — skipping issuance"
fi

# 5) Swap in the real HTTPS vhost ------------------------------------------
log "Installing final HTTPS vhost and reloading nginx"
rm -f "$BOOTSTRAP_CONF"
cp "${PROJECT_DIR}/deploy/nginx/adcrevia.shared.conf" "$FINAL_CONF"
if ! docker exec "$NGINX_CONTAINER" nginx -t; then
  rm -f "$FINAL_CONF"
  die "nginx rejected the adcrevia vhost — removed it again; live sites untouched."
fi
docker exec "$NGINX_CONTAINER" nginx -s reload

# 6) Verify -----------------------------------------------------------------
log "Verifying https://${DOMAIN}"
sleep 3
curl -fsS -o /dev/null -w "   https://${DOMAIN}/ -> %{http_code}\n" "https://${DOMAIN}/" \
  || die "HTTPS check failed — inspect: docker logs ${NGINX_CONTAINER}; ./deploy/deploy.sh logs app"
curl -sS -o /dev/null -w "   https://${WWW}/ -> %{http_code} %{redirect_url}\n" "https://${WWW}/"
certbot certificates -d "$DOMAIN" 2>/dev/null | grep -E 'Expiry|Domains' || true
printf '\n\033[1;32m✅ adcrevia.com is live over HTTPS (auto-renewal via certbot.timer).\033[0m\n'
