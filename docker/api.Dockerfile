# syntax=docker/dockerfile:1.7
# The API runs TypeScript source directly under Node's type stripping — there is no
# build step to keep in sync. tsconfig.base.json sets `erasableSyntaxOnly` so the
# typechecker rejects any syntax this mode could not handle.

FROM node:22-bookworm-slim

RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

WORKDIR /app

# Manifests first: editing a route should not re-resolve the dependency graph.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY packages/contract/package.json ./packages/contract/
COPY apps/api/package.json ./apps/api/

RUN pnpm install --frozen-lockfile --prod --filter "@drawnosaurus/api..."

COPY packages/contract ./packages/contract
COPY apps/api ./apps/api

# The internet link (apps/api/src/tunnel.ts): cloudflared, a static binary, from its own
# pinned image. The API starts it when the Share dialog asks, and stops it again. With
# the CA bundle from the same image: this slim base has none, and without it cloudflared
# cannot verify Cloudflare's certificate — the tunnel failed with "x509: certificate
# signed by unknown authority" before it asked for a name.
COPY --from=cloudflare/cloudflared:2025.9.1 /usr/local/bin/cloudflared /usr/local/bin/cloudflared
COPY --from=cloudflare/cloudflared:2025.9.1 /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt

ENV NODE_ENV=production
ENV PORT=4000
EXPOSE 4000

USER node

CMD ["node", "--experimental-strip-types", "apps/api/src/server.ts"]
