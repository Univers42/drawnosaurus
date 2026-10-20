/**
 * Which build this is: the Docker one (API + Mongo behind the gateway) or the public one
 * (browser only, boards in IndexedDB).
 *
 * A build-time constant on purpose: vite.config.ts folds `VITE_HYDRAWN_MODE` into the
 * bundle, so this comparison is a literal and the minifier drops the other build's code
 * (the public bundle carries no API client paths, the Docker one no IndexedDB store). A
 * runtime flag would ship both and could disagree with the adapter svelte.config.js chose.
 *
 * Only a few places may read it: `lib/store/index.ts`, `lib/config.ts`, the routes, and
 * the dialog picker a later change adds. Everything else asks the store.
 */
export const BROWSER_MODE: boolean = import.meta.env.VITE_HYDRAWN_MODE === "browser";
