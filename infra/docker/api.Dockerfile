# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl tini && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json .npmrc tsconfig.json prisma.config.ts ./
COPY apps ./apps
COPY packages ./packages
COPY infra ./infra
# Source packages use TypeScript exports; tsx is a required runtime dependency in this image.
RUN npm ci --include=dev && npm run db:generate && mkdir -p /app/.local/objects && chown -R node:node /app
ENV NODE_ENV=production PORT=4000
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--import", "tsx", "apps/api/src/main.ts"]
