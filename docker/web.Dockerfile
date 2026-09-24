# syntax=docker/dockerfile:1.7
# Builds the SvelteKit app against the engine SOURCE plus the prebuilt WASM
# artifact. This image carries no Rust toolchain: engine/pkg must already exist in
# the build context (`make wasm`, or the CI wasm job's artifact).

FROM node:22-bookworm-slim AS build

RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

WORKDIR /app

# tsconfig.base.json comes along because apps/web/tsconfig.json extends it and Vite's
# esbuild transform resolves that chain at build time.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc tsconfig.base.json ./
COPY packages/contract/package.json ./packages/contract/
COPY apps/web/package.json ./apps/web/

RUN pnpm install --frozen-lockfile --filter "@drawnosaurus/web..."

COPY packages/contract ./packages/contract
COPY apps/web ./apps/web
COPY engine/src ./engine/src
COPY engine/pkg ./engine/pkg

# Fail with a sentence rather than a Vite resolve error 40 lines deep.
RUN test -f engine/pkg/draw_engine.js && test -f engine/pkg/draw_trace.js \
	|| (echo "engine/pkg is missing or stale: run 'make wasm' before building this image" >&2 && exit 1)

# Declared here, after install, so a new commit invalidates only the build layer and not
# the dependency cache. Vite bakes VITE_* into the bundle; `src/lib/build.ts` reads it.
ARG BUILD_APP_SHA=unknown
ARG BUILD_ENGINE_SHA=unknown
ENV VITE_BUILD_APP_SHA=$BUILD_APP_SHA
ENV VITE_BUILD_ENGINE_SHA=$BUILD_ENGINE_SHA

RUN pnpm --filter @drawnosaurus/web build

FROM node:22-bookworm-slim AS runtime

# The same stamp as a label, so `make stale` can read what a running container was built
# from without opening the app. ARGs do not cross stages, hence the redeclaration.
ARG BUILD_APP_SHA=unknown
ARG BUILD_ENGINE_SHA=unknown
LABEL org.opencontainers.image.revision=$BUILD_APP_SHA \
      drawnosaurus.engine.revision=$BUILD_ENGINE_SHA

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# node_modules comes along because adapter-node leaves non-bundled dependencies
# external. Not size-optimised: correctness first, and this is a dev/CI image.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=build /app/apps/web/build ./apps/web/build
COPY --from=build /app/apps/web/package.json ./apps/web/

EXPOSE 3000

USER node

CMD ["node", "apps/web/build/index.js"]
