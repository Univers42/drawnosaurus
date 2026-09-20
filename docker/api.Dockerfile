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

ENV NODE_ENV=production
ENV PORT=4000
EXPOSE 4000

USER node

CMD ["node", "--experimental-strip-types", "apps/api/src/server.ts"]
