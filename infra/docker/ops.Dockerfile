# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS node-runtime
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps ./apps
COPY packages ./packages
RUN npm ci --include=dev
FROM postgres:17-bookworm
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
COPY --from=node-runtime /app/node_modules /app/node_modules
COPY infra/ops /app/infra/ops
WORKDIR /app
RUN mkdir -p /backups && chown -R postgres:postgres /app /backups
USER postgres
ENTRYPOINT ["node", "--import", "tsx", "infra/ops/backup.ts"]
