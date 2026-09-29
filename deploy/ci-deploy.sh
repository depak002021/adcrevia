#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Continuous deployment of origin/main on the VPS. One script, two triggers:
#   - GitHub Actions (.github/workflows/deploy.yml) over SSH, on every push;
#   - the server's own timer (adcrevia-autodeploy.timer, every 2 minutes),
#     which works even when Actions does not run.
# Both callers run a COPY of this file taken from the fetched commit, so the
# `git reset` below can never rewrite the script while it is executing.
#
# Steps: lock -> sync to origin/main -> skip if already deployed -> nginx
# vhost (only if changed, `nginx -t` first, restored on failure) -> app
# build + migrate + restart (only if app files changed) -> health check ->
# roll back to the previous images on failure.
#
# State: /var/lib/adcrevia-deploy/deployed  last successfully deployed SHA
#        /var/lib/adcrevia-deploy/failed    last SHA that failed (not retried
#                                           by the timer until a new commit)
# ---------------------------------------------------------------------------
set -euo pipefail
export DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1

REPO=/var/www/adcrevia
STATE=/var/lib/adcrevia-deploy
LIVE_VHOST=/var/www/schoolagam/nginx/adcrevia.conf
NGINX=schoolagam_nginx
TRIGGER="${ADCREVIA_DEPLOY_TRIGGER:-manual}"

cd "$REPO"
mkdir -p "$STATE"
compose() { docker compose --env-file .env.production "$@"; }
log() { echo "==> $*"; }

log "Acquiring deploy lock (trigger: ${TRIGGER})"
exec 9>/tmp/adcrevia-deploy.lock
flock -w 900 9 || { echo "❌ Another deploy holds the lock; aborting."; exit 1; }

# .env.production and docker-compose.override.yml are untracked, server-only
# files; `git reset --hard` leaves them in place.
log "Syncing to origin/main"
rm -f .git/refs/remotes/origin/main.lock
git fetch -q --prune --force origin refs/heads/main
TARGET="$(git rev-parse FETCH_HEAD)"
SHORT="$(git rev-parse --short FETCH_HEAD)"
DEPLOYED="$(cat "$STATE/deployed" 2>/dev/null || true)"

if [ "$TARGET" = "$DEPLOYED" ]; then
  git reset -q --hard "$TARGET"
  echo "✅ ${SHORT} is already deployed; nothing to do."
  exit 0
fi
if [ "$TRIGGER" = "timer" ] && [ "$TARGET" = "$(cat "$STATE/failed" 2>/dev/null || true)" ]; then
  echo "⏭  ${SHORT} failed before; the timer will not retry it. Push a fix or run a manual deploy."
  exit 0
fi

# Which parts changed since the last good deploy (everything, if unknown).
if [ -n "$DEPLOYED" ] && git cat-file -e "${DEPLOYED}^{commit}" 2>/dev/null; then
  CHANGED="$(git diff --name-only "$DEPLOYED" "$TARGET")"
else
  CHANGED="(first tracked deploy)"
fi
git reset -q --hard "$TARGET"
PREV="${DEPLOYED:0:7}"
echo "Deploying ${SHORT} (previous: ${PREV:-none})"

mark_failed() { echo "$TARGET" > "$STATE/failed"; }

# ── nginx vhost (only once the certificate exists, i.e. after go-live) ─────
if [ -d /etc/letsencrypt/live/adcrevia.com ] \
   && ! cmp -s deploy/nginx/adcrevia.shared.conf "$LIVE_VHOST"; then
  log "Installing updated nginx vhost"
  cp "$LIVE_VHOST" /tmp/adcrevia.conf.prev 2>/dev/null || true
  cp deploy/nginx/adcrevia.shared.conf "$LIVE_VHOST"
  if ! docker exec "$NGINX" nginx -t; then
    echo "❌ nginx -t rejected the vhost — restoring the previous one (other sites untouched)."
    if [ -f /tmp/adcrevia.conf.prev ]; then cp /tmp/adcrevia.conf.prev "$LIVE_VHOST"; else rm -f "$LIVE_VHOST"; fi
    mark_failed; exit 1
  fi
  docker exec "$NGINX" nginx -s reload
fi

# ── application (skip when only docs / workflows / deploy scripts / the vhost changed)
# (grep without -q reads all input: with pipefail, an early -q exit could
# SIGPIPE printf and be misread as "no application changes".)
APP_FILES="$(printf '%s\n' "$CHANGED" | grep -vE '^(docs/|\.github/|deploy/nginx/|deploy/go-live\.sh$|deploy/ci-deploy\.sh$|.*\.md$)' || true)"
if [ "$CHANGED" != "(first tracked deploy)" ] && [ -z "$APP_FILES" ]; then
  log "No application changes; containers left running"
else
  HAVE_ROLLBACK=0
  if docker image inspect adcrevia-app:latest >/dev/null 2>&1 \
     && docker image inspect adcrevia-build:latest >/dev/null 2>&1; then
    docker tag adcrevia-app:latest   adcrevia-app:rollback
    docker tag adcrevia-build:latest adcrevia-build:rollback
    HAVE_ROLLBACK=1
    log "Saved current app+build images as :rollback"
  fi
  rollback() {
    mark_failed
    if [ "$HAVE_ROLLBACK" -eq 1 ]; then
      log "ROLLING BACK to previous images"
      docker tag adcrevia-app:rollback   adcrevia-app:latest
      docker tag adcrevia-build:rollback adcrevia-build:latest
      compose up -d --no-build --force-recreate app worker
    fi
  }

  # Builds, runs migrations (one-shot `migrate`), restarts app + worker.
  log "Building, migrating & restarting"
  if ! ./deploy/deploy.sh --no-pull; then
    echo "❌ Build/migrate/start failed."
    compose logs --tail=100 migrate app || true
    rollback; exit 1
  fi

  # Healthy = the NEW revision serves AND the database answers. HTTP 503
  # "degraded" only means optional provider keys are unset, so the JSON
  # fields are checked instead of the status code.
  log "Health check"
  ok=0; body=""
  for i in $(seq 1 40); do
    body="$(curl -s --max-time 5 http://127.0.0.1:3210/api/health || true)"
    db="$(printf '%s' "$body" | jq -r '.database // false' 2>/dev/null || echo false)"
    ver="$(printf '%s' "$body" | jq -r '.version // ""' 2>/dev/null || echo "")"
    if [ "$db" = "true" ] && [ "$ver" = "$SHORT" ]; then ok=1; break; fi
    echo "Health attempt ${i}/40 (database=${db} version=${ver:-none}); waiting..."
    sleep 3
  done
  # Pinned to this server's nginx, so it is tested even while some resolver
  # still returns an old IP for adcrevia.com.
  if [ "$ok" -ne 1 ] || ! curl -fsS -o /dev/null --max-time 10 \
       --resolve adcrevia.com:443:127.0.0.1 https://adcrevia.com/; then
    echo "❌ Health check failed."
    compose ps; compose logs --tail=200 app worker || true
    rollback; exit 1
  fi
  printf '%s' "$body" | jq -c '{status, database, services, version}'
  docker image prune -f >/dev/null
fi

echo "$TARGET" > "$STATE/deployed"
rm -f "$STATE/failed"
echo "✅ adcrevia ${SHORT} deployed successfully (trigger: ${TRIGGER})."
