# Deploying Adcrevia to a Hostinger VPS

This runbook takes a fresh Ubuntu VPS to a running `https://adcrevia.com`: the landing
page, the waitlist, the studio, the admin console and the background worker, all from
this repository.

What runs where:

| Piece | Runs as | Reachable from |
|---|---|---|
| PostgreSQL 16 | `db` container, data in the `db-data` volume | the compose network only |
| Migrations | `migrate` container, runs once per deploy and exits | — |
| Web app (Next.js) | `app` container | `127.0.0.1:3000` on the host |
| Background worker | `worker` container (same image as `app`) | — |
| TLS and routing | nginx on the host | the internet, ports 80 and 443 |

Files involved: `Dockerfile`, `docker-compose.yml`, `deploy/deploy.sh`,
`deploy/env.production.example`, `deploy/nginx/adcrevia.conf`.

---

## 1. The server

Ubuntu 22.04 or 24.04. **At least 2 vCPU and 4 GB RAM** (Hostinger KVM 2 or above): the
image build runs `next build`, and the worker runs ffmpeg.

Connect as root (or a sudo user) over SSH, then:

```bash
apt-get update && apt-get upgrade -y
apt-get install -y git nginx certbot python3-certbot-nginx

# Docker Engine and the compose plugin (skip if Hostinger's Docker template is installed)
curl -fsSL https://get.docker.com | sh
docker compose version

# Firewall. The app port is bound to 127.0.0.1, so it is never exposed even though
# Docker publishes ports around ufw.
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable
```

If this VPS already hosts other sites behind nginx, that is fine: this adds one more
site file and does not touch the others. If port 3000 is taken, pick another `APP_PORT`
in step 3 and change the `upstream` in the nginx file to match.

## 2. The code

The GitHub repository is private. The simplest read-only access is a deploy key:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/adcrevia_deploy -N ""
cat ~/.ssh/adcrevia_deploy.pub
```

Add that public key in GitHub → `rootpro-technologies/adcrevia` → Settings → Deploy keys
(read-only), then:

```bash
cat >> ~/.ssh/config <<'EOF'
Host github-adcrevia
  HostName github.com
  IdentityFile ~/.ssh/adcrevia_deploy
  IdentitiesOnly yes
EOF

git clone git@github-adcrevia:rootpro-technologies/adcrevia.git /opt/adcrevia
cd /opt/adcrevia
```

## 3. Configuration

```bash
cp deploy/env.production.example .env.production
chmod 600 .env.production
openssl rand -hex 32      # paste as AUTH_SECRET
openssl rand -base64 32   # paste as ENCRYPTION_KEY
nano .env.production
```

Fill in every value marked REQUIRED. The ones that matter most:

- `APP_URL`, `NEXTAUTH_URL`: exactly `https://adcrevia.com`. Form posts from any
  other origin are refused (403), so this must match the address bar.
- `POSTGRES_PASSWORD`, and the same password inside `DATABASE_URL`.
- `ENCRYPTION_KEY`: back it up somewhere safe. If it is lost or changed, every provider
  key saved in the admin console becomes unreadable.

The provider keys (OpenAI, Runway, R2, Resend) can be added later. Until they are,
`/api/health` reports `degraded`, but the landing page and the waitlist work fully.

## 4. DNS

In hPanel → Domains → adcrevia.com → DNS, point both records at the VPS's IPv4 address:

| Type | Name | Value |
|---|---|---|
| A | `@` | your VPS IP |
| A | `www` | your VPS IP |

Before this change the domain serves the old static site. **Download its waitlist file
first** (step 8), because the old host stops receiving signups the moment DNS moves.

Wait until `dig +short adcrevia.com` returns the VPS IP before the next step.

## 5. TLS certificate

```bash
certbot certonly --nginx -d adcrevia.com -d www.adcrevia.com
```

Certbot installs a renewal timer. Check it with `systemctl list-timers | grep certbot`.

## 6. nginx

```bash
cp deploy/nginx/adcrevia.conf /etc/nginx/sites-available/adcrevia.conf
ln -s /etc/nginx/sites-available/adcrevia.conf /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

The file redirects HTTP to HTTPS and `www` to the apex, passes the real client address
in `X-Real-IP` (the rate limiter depends on it), and turns buffering off for the live
project-updates stream.

## 7. First deploy

```bash
chmod +x deploy/deploy.sh
./deploy/deploy.sh --no-pull
```

This builds the images (several minutes the first time), starts PostgreSQL, applies all
migrations, then starts the app and the worker. Then create the administrator from the
`SUPER_ADMIN_*` values:

```bash
./deploy/deploy.sh bootstrap-admin
```

Sign in at `https://adcrevia.com/admin/login`.

## 8. Bring over the existing waitlist

The old static site saved signups to `adcrevia-data/waitlist.jsonl`, one level above
`public_html`. In hPanel → File Manager, download that file and copy it to the server:

```bash
scp waitlist.jsonl root@YOUR_VPS_IP:/opt/adcrevia/waitlist.jsonl
```

Dry run first. It reports what it would import and any lines it cannot read:

```bash
./deploy/deploy.sh import-waitlist waitlist.jsonl
./deploy/deploy.sh import-waitlist waitlist.jsonl --apply
rm waitlist.jsonl
```

It is safe to run more than once: emails already in the database are left alone. The
signups then appear under Admin → Waitlist.

## 9. Check it

```bash
./deploy/deploy.sh status                      # containers + health JSON
./deploy/deploy.sh logs app                    # or: worker, db, migrate
docker compose --env-file .env.production run --rm \
  -e SMOKE_BASE_URL=https://adcrevia.com migrate pnpm smoke:production
```

In a browser: the landing page loads, the waitlist form shows "You are on the list.",
"Sign in" reaches `/login`, and the signup appears under Admin → Waitlist.

## Updating

```bash
cd /opt/adcrevia
./deploy/deploy.sh
```

This pulls `main`, rebuilds, applies any new migrations, and restarts. The worker
finishes in-flight jobs before it stops; anything still running is picked up again after
the restart.

## Backups

```bash
mkdir -p /opt/backups
docker compose --env-file .env.production exec -T db \
  pg_dump -U adcrevia -d adcrevia --format=custom > /opt/backups/adcrevia-$(date +%F).dump
```

For a daily backup kept for 14 days, add this with `crontab -e`:

```
15 3 * * * cd /opt/adcrevia && docker compose --env-file .env.production exec -T db pg_dump -U adcrevia -d adcrevia --format=custom > /opt/backups/adcrevia-$(date +\%F).dump && find /opt/backups -name 'adcrevia-*.dump' -mtime +14 -delete
```

Also keep a copy of `.env.production` off the server. Without `ENCRYPTION_KEY`, a restored
database cannot decrypt its stored provider keys.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `status` shows `degraded` / app `unhealthy` | A required key is empty in `.env.production`; the health JSON lists which services are false. |
| Forms fail with "Request blocked: unrecognised origin" (403) | `APP_URL` does not match the address in the browser (http vs https, www vs apex). |
| 502 Bad Gateway | The app container is not running or `APP_PORT` differs from the nginx `upstream`. Check `./deploy/deploy.sh logs app`. |
| Studio progress never updates | The events `location` block is missing from the nginx site, so responses are buffered. |
| `migrate` exits non-zero | `./deploy/deploy.sh logs migrate`. The app and worker deliberately do not start on a failed migration. |

---

## The production VPS as actually deployed (187.127.134.41)

The live server also hosts other sites, so it differs from the generic steps above:

| Topic | On this VPS |
|---|---|
| Code | `/var/www/adcrevia` (deploy key alias `github-adcrevia`) |
| Public nginx | The shared **container** `schoolagam_nginx` (ports 80/443), not host nginx. Its `conf.d` is `/var/www/schoolagam/nginx`; the adcrevia vhost there is a copy of `deploy/nginx/adcrevia.shared.conf`. |
| Server-only compose file | `docker-compose.override.yml` (untracked): joins `app` to the `schoolagam_default` network as `adcrevia-app`, gives the database the alias `adcrevia-db` (schoolagam also has a `db`), and publishes the app on `127.0.0.1:3210` because 3000 is taken. |
| Email | SMTP through `mail.adcrevia.com:465` as `admin@adcrevia.com`, configured in **Admin → Email** (the `SMTP_*` values in `.env.production` are only the fallback). |
| TLS | `deploy/go-live.sh` issued the certificate (webroot `/var/www/certbot`). `certbot.timer` renews it; `/etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh` reloads nginx. |
| Backups | `/etc/cron.d/adcrevia-backup`: daily `pg_dump` at 03:15 to `/var/backups/adcrevia`, 14 days kept. |

### What is configured in the admin console

Everything a client-side operator normally changes is in the console, encrypted where
secret, and takes effect without a deploy. `.env.production` values are used only when
nothing is saved in the console.

| Console page | Configures |
|---|---|
| Image providers / Video providers / FLUX | OpenAI, Google, FLUX and Runway keys and models (the OpenAI key also powers text) |
| AI text | Writing, brief-assistant and decision models; optional TypeSafe Jev key |
| Storage | Cloudflare R2 (or any S3-compatible) bucket |
| Email | SMTP mailbox or Resend key, sender name and address |
| System settings | Images per project; read-only status of decisions, storage and ffmpeg |

`/api/health` reports `ready` once OpenAI, an image provider, a video provider, storage
and email are configured in either place.

Server-only settings stay in `.env.production`: database, `AUTH_SECRET`,
`ENCRYPTION_KEY` (never change it: saved keys become unreadable), public URLs, worker
tuning.

### Continuous deployment

Every push to `main` is deployed by `deploy/ci-deploy.sh`, from two triggers that share
one lock and one record of what is deployed (`/var/lib/adcrevia-deploy`):

- `adcrevia-autodeploy.timer` on the server checks `origin/main` every 2 minutes;
- `.github/workflows/deploy.yml` runs it over SSH when GitHub Actions is available.

It rebuilds only when application files changed, installs the nginx vhost only after
`nginx -t` passes, and rolls back to the previous images if the new revision is not
serving with a live database. A commit that fails is not retried by the timer until a
newer commit arrives.

```bash
journalctl -u adcrevia-autodeploy -n 50        # what the timer did
cat /var/lib/adcrevia-deploy/deployed          # commit currently deployed
systemctl start adcrevia-autodeploy            # check GitHub right now
```
