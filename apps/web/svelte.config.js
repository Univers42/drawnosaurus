import adapterNode from "@sveltejs/adapter-node";
import adapterStatic from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

// Same test as lib/mode.ts; svelte.config.js cannot import it. vite.config.ts validates the value.
const browser = process.env.VITE_HYDRAWN_MODE === "browser";

/** @type {import('@sveltejs/kit').Config} */
export default {
  preprocess: vitePreprocess(),
  compilerOptions: {
    // The engine's Svelte adapter is runes-only (engine/svelte.config.js).
    runes: true,
  },
  kit: {
    adapter: browser
      ? adapterStatic({ pages: "build", assets: "build", fallback: "index.html" })
      : adapterNode({ out: "build" }),
    // Declared ONCE here: SvelteKit feeds this to both Vite's resolver and the
    // generated tsconfig, so the bundler and the typechecker cannot disagree.
    // Hand-writing `paths` in tsconfig.json instead would clobber SvelteKit's own
    // ($lib, $app/types) and it warns about exactly that.
    alias: {
      "@osionos/draw-engine": "../../engine/src",
    },
  },
};
