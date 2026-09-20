FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY server/package.json ./server/
COPY web/package.json ./web/
RUN npm ci

COPY packages/shared ./packages/shared
COPY web ./web
RUN npm run build -w @task-engine/shared && npm run build -w @task-engine/web

# nginx serves the bundle and proxies /api, so the browser only ever sees one
# origin and the app never needs an API base URL.
FROM nginx:1.27-alpine
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/web/dist /usr/share/nginx/html
EXPOSE 80
