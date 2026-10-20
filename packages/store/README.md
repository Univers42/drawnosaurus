# @drawnosaurus/store

The online copy of a shared drawing: sealed bytes on D1 behind a Cloudflare Pages Function
(`functions/store/[[path]].ts`), and the same handlers over an in-memory fake for `vite dev`
(`src/devMiddleware.ts`). The protocol is at the top of `src/handlers.ts`; the free-plan
figures are in `src/limits.ts`.

**Task 6:** once `apps/web` depends on this package, `docker/web.Dockerfile` needs
`COPY packages/store/package.json ./packages/store/` before its install and
`COPY packages/store ./packages/store` before its build, or the image breaks.
