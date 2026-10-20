<script lang="ts">
  import type { Snippet } from "svelte";
  import { page } from "$app/state";

  let { children }: { children: Snippet } = $props();

  // One board page per slug. SvelteKit keeps a page when only its params change — a
  // template picked inside a board goes from /boards/A to /boards/B — so the page built for
  // A, its scene, saver, draft and live link, went on showing A at B's address. Keyed, A's
  // page is torn down as any page left is (`beforeNavigate` sends what is pending first),
  // and B's is built from nothing.
</script>

{#key page.params.slug}
  {@render children()}
{/key}
