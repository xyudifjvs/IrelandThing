# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl tini && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json tsconfig.json prisma.config.ts ./
COPY apps ./apps
COPY packages ./packages
COPY infra ./infra
# Source packages use TypeScript exports; tsx is a required runtime dependency in this image.
RUN npm ci --include=dev && npm run db:generate && mkdir -p /app/.local/objects && chown -R node:node /app
ENV NODE_ENV=production PORT=5000 WORKER_PORT=5000
USER node
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+(process.env.WORKER_PORT||process.env.PORT||5000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--import", "tsx", "apps/worker/src/main.ts"]
