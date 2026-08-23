FROM node:22-bookworm-slim

# build tools only matter if better-sqlite3 has no prebuilt binary for this platform
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/mental-poker/package.json packages/mental-poker/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci

COPY . .
RUN npm run build --workspace @4am/web

ENV NODE_ENV=production
ENV PORT=8787
ENV DB_PATH=/data/4amcasino.db
RUN mkdir -p /data
VOLUME /data
EXPOSE 8787

CMD ["npx", "tsx", "apps/server/src/index.ts"]
