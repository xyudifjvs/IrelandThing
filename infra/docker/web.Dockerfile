# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl tini && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json tsconfig.json prisma.config.ts ./
COPY apps ./apps
COPY packages ./packages
COPY infra ./infra
RUN npm ci --include=dev && npm run db:generate
# Rewrites and NEXT_PUBLIC values are compiled. Set these to the target environment at build time.
ARG API_INTERNAL_URL
ARG NEXT_PUBLIC_APP_ENV=production
ENV API_INTERNAL_URL=$API_INTERNAL_URL NEXT_PUBLIC_APP_ENV=$NEXT_PUBLIC_APP_ENV NEXT_TELEMETRY_DISABLED=1
RUN test -n "$API_INTERNAL_URL" && npm run build --workspace @weatherly/web
RUN chown -R node:node /app
ENV NODE_ENV=production PORT=3000
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "-c", "exec node node_modules/next/dist/bin/next start apps/web --hostname :: --port ${PORT:-3000}"]
