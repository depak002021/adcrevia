#!/usr/bin/env bash
#
# Build and (re)start Adcrevia on the VPS. Run from the repository root.
#
#   ./deploy/deploy.sh                 pull the latest main, build, migrate, restart
#   ./deploy/deploy.sh --no-pull       build and restart what is checked out now
#   ./deploy/deploy.sh bootstrap-admin create or reset the super administrator
#   ./deploy/deploy.sh import-waitlist <file.jsonl> [--apply]
#                                      import signups from the old static site
#   ./deploy/deploy.sh status          container state and the health endpoint
#   ./deploy/deploy.sh logs [service]  follow logs (app, worker, db, migrate)
#
# Every compose call goes through `compose` below, so the same .env.production supplies
# both the containers' environment and the build arguments.

set -euo pipefail

cd "$(dirname "$0")/.."

ENV_FILE=".env.production"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE. Copy deploy/env.production.example to $ENV_FILE and fill it in." >&2
  exit 1
fi

compose() {
  docker compose --env-file "$ENV_FILE" "$@"
}

command="${1:-deploy}"

case "$command" in
  deploy | --no-pull)
    if [[ "$command" != "--no-pull" ]]; then
      git pull --ff-only
    fi
    # Reported by /api/health and the worker's startup line, so a running container can
    # always be traced back to a commit.
    APP_REVISION="$(git rev-parse --short HEAD)"
    export APP_REVISION
    echo "Building revision $APP_REVISION"

    compose build migrate app
    compose up -d db
    # Runs pending migrations and exits; app and worker wait for it to succeed.
    compose up -d --force-recreate app worker
    compose ps
    echo
    echo "Deployed $APP_REVISION. Check: ./deploy/deploy.sh status"
    ;;

  bootstrap-admin)
    compose run --rm migrate pnpm admin:bootstrap
    ;;

  import-waitlist)
    file="${2:?usage: deploy.sh import-waitlist <file.jsonl> [--apply]}"
    shift 2
    compose run --rm -v "$(realpath "$file"):/tmp/waitlist.jsonl:ro" migrate \
      pnpm waitlist:import /tmp/waitlist.jsonl "$@"
    ;;

  status)
    compose ps
    port="$(grep -E '^APP_PORT=' "$ENV_FILE" | cut -d= -f2 | tr -d '"' || true)"
    echo
    curl -sS "http://127.0.0.1:${port:-3000}/api/health" || echo "health endpoint unreachable"
    echo
    ;;

  logs)
    compose logs -f --tail=200 "${2:-app}"
    ;;

  *)
    echo "Unknown command: $command" >&2
    exit 2
    ;;
esac
