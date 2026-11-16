#!/usr/bin/env bash
# Boots the production images the way ECS runs them, on one machine (ARCHITECTURE-REVIEW A12; the
# 12 November rehearsal in docs/INFRASTRUCTURE.md found 8 production-only bugs this way):
#   - PostgreSQL 16 with TLS only and a certificate checked against a throwaway CA, and an owner
#     role that is NOT a superuser (CREATEROLE, CREATEDB, owns the database), like the RDS master;
#   - the db-roles task, then the migrate task (prisma migrate deploy, rls.sql, union_hub.sql) and a
#     second migrate run (a redeploy), then an operator script (platform:admin), all as that owner;
#   - the API and the worker with NODE_ENV=production and certificate-verifying database URLs, and
#     the web app pointing at the API, as compute.tf configures them.
# Checks: /healthz, /readyz?strict=1 (database, outboxes, worker heartbeat through the owner's
# SECURITY DEFINER functions), the release header, and the web app answering.
#
#   TAG=<image tag> bash ops/ci/image-smoke.sh     (images fh-api:$TAG, fh-migrate:$TAG, fh-web:$TAG)
set -euo pipefail
TAG="${TAG:?}"
work=$(mktemp -d)
net=fh-smoke-$$
pw() { openssl rand -hex 24; }
OWNER_PW=$(pw)
APP_PW=$(pw)
UNION_PW=$(pw)

cleanup() {
  status=$?
  if [ $status -ne 0 ]; then
    for c in api worker web; do echo "---- $c logs"; docker logs "$net-$c" 2>&1 | tail -60 || true; done
    echo "---- db logs"; docker logs "$net-db" 2>&1 | tail -30 || true
  fi
  docker rm -f "$net-db" "$net-api" "$net-worker" "$net-web" >/dev/null 2>&1 || true
  docker network rm "$net" >/dev/null 2>&1 || true
  rm -rf "$work"
  exit $status
}
trap cleanup EXIT

# TLS: a throwaway CA and a server certificate for the host name "db".
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=fh-smoke-ca" -keyout "$work/ca.key" -out "$work/ca.pem" 2>/dev/null
openssl req -newkey rsa:2048 -nodes -subj "/CN=db" -keyout "$work/server.key" -out "$work/server.csr" 2>/dev/null
printf 'subjectAltName=DNS:db\n' > "$work/san.ext"
openssl x509 -req -in "$work/server.csr" -CA "$work/ca.pem" -CAkey "$work/ca.key" -CAcreateserial -days 1 -extfile "$work/san.ext" -out "$work/server.crt" 2>/dev/null
# Like rds.force_ssl=1: no connection without TLS, except the local socket used to set up the owner.
printf 'local all all trust\nhostssl all all 0.0.0.0/0 scram-sha-256\nhostnossl all all 0.0.0.0/0 reject\n' > "$work/pg_hba.conf"
chmod 644 "$work"/*
chmod 755 "$work" # the containers' own users (node, postgres) read the CA and certificates

docker network create "$net" >/dev/null
docker run -d --name "$net-db" --network "$net" --network-alias db -e POSTGRES_PASSWORD="$(pw)" -v "$work:/certs:ro" postgres:16 \
  sh -c 'cp /certs/server.crt /certs/server.key /certs/pg_hba.conf /var/lib/postgresql/ && chown postgres /var/lib/postgresql/server.* /var/lib/postgresql/pg_hba.conf && chmod 600 /var/lib/postgresql/server.key &&
         exec docker-entrypoint.sh postgres -c ssl=on -c ssl_cert_file=/var/lib/postgresql/server.crt -c ssl_key_file=/var/lib/postgresql/server.key -c hba_file=/var/lib/postgresql/pg_hba.conf' >/dev/null
for _ in $(seq 1 60); do docker exec "$net-db" pg_isready -U postgres -h /var/run/postgresql >/dev/null 2>&1 && break; sleep 1; done
sleep 2 # the image restarts the server once after its first initialisation
for _ in $(seq 1 30); do docker exec "$net-db" pg_isready -U postgres -h /var/run/postgresql >/dev/null 2>&1 && break; sleep 1; done
# The RDS master user: not a superuser.
docker exec "$net-db" psql -v ON_ERROR_STOP=1 -U postgres -h /var/run/postgresql -q \
  -c "CREATE ROLE fh_owner LOGIN CREATEROLE CREATEDB PASSWORD '$OWNER_PW'" -c "CREATE DATABASE flexcity OWNER fh_owner"

OWNER_ENV=(-e NODE_ENV=production -e DB_HOST=db -e DB_NAME=flexcity -e DB_USER=fh_owner -e DB_PASSWORD="$OWNER_PW" -e DB_SSLROOTCERT=/certs/ca.pem)
run_job() { docker run --rm --network "$net" -v "$work:/certs:ro" "${OWNER_ENV[@]}" "$@"; }

echo "== db-roles task"
run_job -e FLEXCITY_APP_PASSWORD="$APP_PW" -e FLEXCITY_UNION_PASSWORD="$UNION_PW" "fh-migrate:$TAG" node scripts/set-role-passwords.mjs
echo "== migrate task"
run_job "fh-migrate:$TAG"
echo "== migrate task again (a redeploy)"
run_job "fh-migrate:$TAG"
echo "== operator script as the owner (platform:admin)"
run_job -e PLATFORM_ADMIN_PASSWORD="$(pw)" "fh-migrate:$TAG" npm run -s platform:admin -- console@example.ca "Smoke Test"

db_url() { echo "postgresql://$1:$2@db:5432/flexcity?sslmode=verify-full&sslrootcert=/certs/ca.pem"; }
APP_ENV=(-e NODE_ENV=production -e AWS_REGION=ca-central-1 -e KMS_KEY_ARN=arn:aws:kms:ca-central-1:111122223333:key/smoke
  -e ROOT_DOMAIN=example.ca -e "PUBLIC_APP_URL=https://{subdomain}.example.ca" -e RELEASE="$TAG" -e WEB_CONCURRENCY=1
  -e JWT_SECRET="$(openssl rand -base64 48)" -e METRICS_TOKEN="$(pw)"
  -e APP_DATABASE_URL="$(db_url flexcity_app "$APP_PW")" -e LISTEN_DATABASE_URL="$(db_url flexcity_app "$APP_PW")")

echo "== API and worker"
docker run -d --name "$net-api" --network "$net" --network-alias api -p 127.0.0.1:4000:4000 -v "$work:/certs:ro" "${APP_ENV[@]}" -e PORT=4000 "fh-api:$TAG" >/dev/null
docker run -d --name "$net-worker" --network "$net" -v "$work:/certs:ro" "${APP_ENV[@]}" "fh-api:$TAG" node dist/worker.js >/dev/null
echo "== web"
docker run -d --name "$net-web" --network "$net" -p 127.0.0.1:3000:3000 -e NODE_ENV=production -e ROOT_DOMAIN=example.ca -e API_URL=http://api:4000 "fh-web:$TAG" >/dev/null

wait_for() { # <what> <seconds> <command...>
  local what=$1 secs=$2; shift 2
  for _ in $(seq 1 "$secs"); do "$@" >/dev/null 2>&1 && { echo "ok: $what"; return 0; }; sleep 1; done
  echo "FAILED: $what"; "$@" || true; return 1
}
wait_for "API /healthz" 60 curl -fsS http://127.0.0.1:4000/healthz
# Strict readiness needs the worker's heartbeat (its first minute round) and the outboxes moving.
wait_for "API /readyz?strict=1" 150 curl -fsS "http://127.0.0.1:4000/readyz?strict=1"
seen=$(curl -fsS -o /dev/null -D - http://127.0.0.1:4000/api/version | tr -d '\r' | awk -F': ' 'tolower($1)=="x-fh-version"{print $2}')
[ "$seen" = "$TAG" ] || { echo "FAILED: X-FH-Version is '$seen', expected $TAG"; exit 1; }
echo "ok: release header $seen"
web_ok() { code=$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: smoke.example.ca' http://127.0.0.1:3000/); [ "$code" -ge 200 ] && [ "$code" -lt 500 ]; }
wait_for "web answers" 60 web_ok
echo "Images boot as in production."
