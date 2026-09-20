# One image, two commands: docker-compose runs it as `api` and as `worker`.
# They share every line of source and differ only in their entrypoint.

FROM node:22-alpine AS build
WORKDIR /app

# Manifests first, so a source change does not invalidate the install layer.
COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY server/package.json ./server/
COPY web/package.json ./web/
RUN npm ci

COPY packages/shared ./packages/shared
COPY server ./server
RUN npm run build -w @task-engine/shared && npm run build -w @task-engine/server

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY server/package.json ./server/
COPY web/package.json ./web/
RUN npm ci --omit=dev --workspace @task-engine/shared --workspace @task-engine/server \
    --include-workspace-root && npm cache clean --force

COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/server/dist ./server/dist
# Read at boot by the migrator, so they ship with the image.
COPY server/migrations ./server/migrations

USER node
EXPOSE 3000
CMD ["node", "server/dist/server.js"]
