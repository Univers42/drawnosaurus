<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { resolve } from "$app/paths";
  import { recallLastDrawing } from "$lib/boards/lastDrawing.ts";
  import Gallery from "$lib/gallery/Gallery.svelte";
  import { BROWSER_MODE } from "$lib/mode.ts";
  import { mintSlug } from "$lib/store/browser.ts";

  // The public build opens a drawing rather than the gallery: the one last open in this
  // browser, or a new one (the spec's Goal 1). Nothing is stored for it here — its row comes
  // with its first save — so visiting does not fill the gallery with blanks. `/` is replaced
  // in the history, or Back would land here only to be sent on again.
  onMount(() => {
    if (!BROWSER_MODE) return;
    const slug = recallLastDrawing(localStorage) ?? mintSlug();
    void goto(resolve("/boards/[slug]", { slug }), { replaceState: true });
  });
</script>

{#if !BROWSER_MODE}
  <Gallery />
{/if}
