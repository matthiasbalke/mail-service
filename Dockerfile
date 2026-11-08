# syntax=docker/dockerfile:1
ARG BUN_VERSION=1.4.4
FROM oven/bun:${BUN_VERSION} AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
RUN bun run build

FROM oven/bun:${BUN_VERSION} AS production-dependencies
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:${BUN_VERSION}-distroless AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER 65532:65532
STOPSIGNAL SIGTERM
ENTRYPOINT ["/usr/local/bin/bun", "dist/main.js"]
