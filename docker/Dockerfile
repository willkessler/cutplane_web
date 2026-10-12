# Production image: build the static site, then serve it with Caddy on $PORT
# (Render and Railway both inject PORT).
FROM node:24-bookworm-slim AS build
RUN npm install -g pnpm@12.12.1
WORKDIR /work
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/kernel/package.json packages/kernel/
COPY packages/formats/package.json packages/formats/
COPY packages/booleans/package.json packages/booleans/
COPY packages/cpl/package.json packages/cpl/
COPY packages/behaviors/package.json packages/behaviors/
COPY packages/app/package.json packages/app/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM caddy:2-alpine
COPY docker/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /work/packages/app/dist /srv
ENV PORT=8080
EXPOSE 8080
