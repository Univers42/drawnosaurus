import adapter from "@sveltejs/adapter-node";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
export default {
  preprocess: vitePreprocess(),
  compilerOptions: {
    // The engine's Svelte adapter is runes-only (engine/svelte.config.js).
    runes: true,
  },
  kit: {
    adapter: adapter({ out: "build" }),
    // Declared ONCE here: SvelteKit feeds this to both Vite's resolver and the
    // generated tsconfig, so the bundler and the typechecker cannot disagree.
    // Hand-writing `paths` in tsconfig.json instead would clobber SvelteKit's own
    // ($lib, $app/types) and it warns about exactly that.
    alias: {
      "@osionos/draw-engine": "../../engine/src",
    },
  },
};
