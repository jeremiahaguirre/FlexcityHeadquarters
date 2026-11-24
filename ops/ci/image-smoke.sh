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
# SECURITY DEFINER functions), the release header; then real requests under row-level security as
# the app role: a Dev console sign-in (FH-only tables, no organization chosen) and a signed-in
# person's GET /api/me in a seeded organization (FORCE ROW LEVEL SECURITY with app.tenant_id set);
# and the web app's sign-in page showing that organization's name, which its server render
# fetched from the API.
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
PLATFORM_PW=$(pw)
CONSOLE_PW=$(pw)
JWT_SECRET=$(openssl rand -hex 48)
# PostgreSQL 16, pinned by digest (as the Dockerfile pins its base image).
PG_IMAGE=postgres:16@sha256:dd2bf3ce2dc83a81674cf7f217fcfd8a5009a4b325dda5b843bfee82a06cff6f

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
docker run -d --name "$net-db" --network "$net" --network-alias db -e POSTGRES_PASSWORD="$(pw)" -v "$work:/certs:ro" "$PG_IMAGE" \
  sh -c 'cp /certs/server.crt /certs/server.key /certs/pg_hba.conf /var/lib/postgresql/ && chown postgres /var/lib/postgresql/server.* /var/lib/postgresql/pg_hba.conf && chmod 600 /var/lib/postgresql/server.key &&
         exec docker-entrypoint.sh postgres -c ssl=on -c ssl_cert_file=/var/lib/postgresql/server.crt -c ssl_key_file=/var/lib/postgresql/server.key -c hba_file=/var/lib/postgresql/pg_hba.conf' >/dev/null
# Over TCP: only the final server listens there (the image's first-run server is socket-only), and a
# refused (non-TLS) connection still counts as accepting.
for _ in $(seq 1 90); do docker exec "$net-db" pg_isready -U postgres -h 127.0.0.1 >/dev/null 2>&1 && break; sleep 1; done
# The RDS master user: not a superuser.
docker exec "$net-db" psql -v ON_ERROR_STOP=1 -U postgres -h /var/run/postgresql -q \
  -c "CREATE ROLE fh_owner LOGIN CREATEROLE CREATEDB PASSWORD '$OWNER_PW'" -c "CREATE DATABASE flexcity OWNER fh_owner"

OWNER_ENV=(-e NODE_ENV=production -e DB_HOST=db -e DB_NAME=flexcity -e DB_USER=fh_owner -e DB_PASSWORD="$OWNER_PW" -e DB_SSLROOTCERT=/certs/ca.pem)
run_job() { docker run --rm --network "$net" -v "$work:/certs:ro" "${OWNER_ENV[@]}" "$@"; }

echo "== db-roles task"
run_job -e FLEXCITY_APP_PASSWORD="$APP_PW" -e FLEXCITY_PLATFORM_PASSWORD="$PLATFORM_PW" -e FLEXCITY_UNION_PASSWORD="$UNION_PW" "fh-migrate:$TAG" node scripts/set-role-passwords.mjs
echo "== migrate task"
run_job "fh-migrate:$TAG"
echo "== migrate task again (a redeploy)"
run_job "fh-migrate:$TAG"
echo "== operator script as the owner (platform:admin)"
run_job -e PLATFORM_ADMIN_PASSWORD="$CONSOLE_PW" "fh-migrate:$TAG" npm run -s platform:admin -- console@example.ca "Smoke Test"

# One organization and one person in it, written directly (no sign-in flow needed: the API's own
# access token is minted below with the same secret the API is given).
TENANT_ID=$(docker exec "$net-db" psql -v ON_ERROR_STOP=1 -U postgres -h /var/run/postgresql -d flexcity -Atq \
  -c "INSERT INTO \"Tenant\" (id, name, subdomain, \"updatedAt\") VALUES (gen_random_uuid(), 'Smoke Test City', 'smoke', now()) RETURNING id")
USER_ID=$(docker exec "$net-db" psql -v ON_ERROR_STOP=1 -U postgres -h /var/run/postgresql -d flexcity -Atq \
  -c "INSERT INTO \"User\" (id, \"tenantId\", email, \"firstName\", \"lastName\", \"employmentStatus\", roles, \"updatedAt\") VALUES (gen_random_uuid(), '$TENANT_ID', 'staff@smoke.example.ca', 'Sam', 'Smoke', 'PART_TIME', ARRAY['STAFF']::\"AccessRole\"[], now()) RETURNING id")

db_url() { echo "postgresql://$1:$2@db:5432/flexcity?sslmode=verify-full&sslrootcert=/certs/ca.pem"; }
APP_ENV=(-e NODE_ENV=production -e AWS_REGION=ca-central-1 -e KMS_KEY_ARN=arn:aws:kms:ca-central-1:111122223333:key/smoke
  -e ROOT_DOMAIN=example.ca -e "PUBLIC_APP_URL=https://{subdomain}.example.ca" -e RELEASE="$TAG" -e WEB_CONCURRENCY=1
  -e JWT_SECRET="$JWT_SECRET" -e METRICS_TOKEN="$(pw)"
  -e APP_DATABASE_URL="$(db_url flexcity_app "$APP_PW")" -e PLATFORM_DATABASE_URL="$(db_url flexcity_platform "$PLATFORM_PW")" -e LISTEN_DATABASE_URL="$(db_url flexcity_app "$APP_PW")")

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
C=(curl -fsS --max-time 5)
wait_for "API /healthz" 60 "${C[@]}" http://127.0.0.1:4000/healthz
# Strict readiness needs the worker's heartbeat (its first minute round) and the outboxes moving.
wait_for "API /readyz?strict=1" 150 "${C[@]}" "http://127.0.0.1:4000/readyz?strict=1"
seen=$("${C[@]}" -o /dev/null -D - http://127.0.0.1:4000/api/version | tr -d '\r' | awk -F': ' 'tolower($1)=="x-fh-version"{print $2}')
[ "$seen" = "$TAG" ] || { echo "FAILED: X-FH-Version is '$seen', expected $TAG"; exit 1; }
echo "ok: release header $seen"
# Row-level security in force, as the app role. The Dev console sign-in reads and updates
# PlatformAdmin and creates a session with no organization chosen.
login=$("${C[@]}" -H 'x-fh-platform: 1' -H 'content-type: application/json' \
  -d "{\"email\":\"console@example.ca\",\"password\":\"$CONSOLE_PW\"}" http://127.0.0.1:4000/api/platform/auth/login) ||
  { echo "FAILED: Dev console sign-in"; exit 1; }
grep -q '"email":"console@example.ca"' <<<"$login" || { echo "FAILED: Dev console sign-in answered $login"; exit 1; }
echo "ok: Dev console sign-in (FH tables, no organization)"
# A person's own record and organization, read inside that organization's transaction.
b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
now=$(date +%s)
jwt_head=$(printf '{"alg":"HS256"}' | b64url)
jwt_body=$(printf '{"tid":"%s","roles":["STAFF"],"aat":%d,"sub":"%s","iat":%d,"exp":%d}' "$TENANT_ID" "$now" "$USER_ID" "$now" $((now + 600)) | b64url)
jwt_sig=$(printf '%s.%s' "$jwt_head" "$jwt_body" | openssl dgst -sha256 -hmac "$JWT_SECRET" -binary | b64url)
me=$("${C[@]}" -H "Authorization: Bearer $jwt_head.$jwt_body.$jwt_sig" -H 'Host: smoke.example.ca' -H 'X-Forwarded-Host: smoke.example.ca' \
  http://127.0.0.1:4000/api/me) || { echo "FAILED: GET /api/me as a signed-in person"; "${C[@]}" -H "Authorization: Bearer $jwt_head.$jwt_body.$jwt_sig" -H 'X-Forwarded-Host: smoke.example.ca' http://127.0.0.1:4000/api/me || true; exit 1; }
grep -q '"email":"staff@smoke.example.ca"' <<<"$me" || { echo "FAILED: /api/me answered $me"; exit 1; }
echo "ok: GET /api/me under row-level security (the organization's own rows)"

# The web app's sign-in page for that organization: 200, with the name its server render fetched
# from the API at API_URL.
web_ok() { page=$(curl -s --max-time 10 -H 'Host: smoke.example.ca' -w '\n%{http_code}' http://127.0.0.1:3000/login) && [ "${page##*$'\n'}" = "200" ] && grep -q 'Smoke Test City' <<<"$page"; }
wait_for "web sign-in page shows the organization (API reached from the web server)" 60 web_ok
echo "Images boot as in production."
