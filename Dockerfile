# syntax=docker/dockerfile:1.7
#
# FlexcityHeadquarters container images (AWS ECS Fargate, ca-central-1). One file, three targets:
#
#   docker build --target api     -t fh-api .   # API; the worker is the same image with `node dist/worker.js`
#   docker build --target migrate -t fh-migrate .  # one-off task: prisma migrate deploy + RLS/roles SQL
#   docker build --target web --build-arg API_URL=http://api.internal:4000 -t fh-web .
#
# The marketing site (apps/site) is a static export served from S3, not a container.
# Base image pinned by digest: Node 26 (the version package.json requires), Debian bookworm slim.

ARG NODE_IMAGE=node:26.12.0-bookworm-slim@sha256:742a0fe7320e09e0321222b68165e6ac731d30470e7ea7f98f9bfc3a6e1034fe

FROM ${NODE_IMAGE} AS base
# Prisma's query engine needs OpenSSL; ca-certificates for TLS to RDS, Twilio and the rest.
RUN dpkg -s openssl ca-certificates >/dev/null 2>&1 || (apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*)
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false

# ---- API -------------------------------------------------------------------------------------
FROM base AS api-build
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
RUN npm ci --workspace apps/api --include-workspace-root
COPY apps/api apps/api
RUN cd apps/api && npx prisma generate && npm run build

FROM base AS api-deps
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/api/prisma apps/api/prisma
RUN npm ci --workspace apps/api --include-workspace-root --omit=dev
# The generated Prisma client (with its engine) from the build stage.
COPY --from=api-build /app/node_modules/.prisma node_modules/.prisma

FROM base AS api
ENV NODE_ENV=production PORT=4000
COPY --from=api-deps /app/node_modules node_modules
COPY --from=api-deps /app/package.json package.json
COPY apps/api/package.json apps/api/
COPY apps/api/db apps/api/db
COPY --from=api-build /app/apps/api/dist apps/api/dist
WORKDIR /app/apps/api
USER node
EXPOSE 4000
# The load balancer checks /readyz; this only tells ECS the process answers at all.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/server.js"]

# ---- Migrations (one-off task before each deployment) ----------------------------------------
FROM api-build AS migrate
ENV NODE_ENV=production
WORKDIR /app/apps/api
USER node
CMD ["npm", "run", "db:migrate"]

# ---- Web app ---------------------------------------------------------------------------------
FROM base AS web-build
# Baked in at build time: where /api/* is sent when the load balancer hasn't already routed it.
ARG API_URL=http://localhost:4000
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_RELEASE
ENV API_URL=${API_URL} NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL} NEXT_PUBLIC_RELEASE=${NEXT_PUBLIC_RELEASE} NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
RUN npm ci --workspace apps/web --include-workspace-root
COPY apps/web apps/web
# The static demo's staff-import preview reuses the API's own parser (apps/web/src/lib/demoApi.ts).
COPY apps/api/src/services/platform/staffImport.ts apps/api/src/services/platform/staffImport.ts
RUN cd apps/web && npx next build

FROM base AS web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
RUN npm ci --workspace apps/web --include-workspace-root --omit=dev
COPY --from=web-build /app/apps/web/.next apps/web/.next
COPY --from=web-build /app/apps/web/public apps/web/public
COPY --from=web-build /app/apps/web/next.config.mjs apps/web/next.config.mjs
WORKDIR /app/apps/web
USER node
EXPOSE 3000
CMD ["npx", "next", "start", "-p", "3000"]
