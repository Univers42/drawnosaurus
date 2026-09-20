<script lang="ts">
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import "../app.css";

  let { children } = $props();
  const onBoard = $derived(page.url.pathname.includes("/boards/"));
</script>

<div class="shell">
  {#if !onBoard}
    <header>
      <a class="brand" href={resolve("/")}>drawnosaurus</a>
      <span class="tagline">Rust/WASM canvas, boards in MongoDB</span>
    </header>
  {/if}

  <main>
    {@render children?.()}
  </main>
</div>

<style>
  .shell {
    display: flex;
    flex-direction: column;
    height: 100vh;
  }

  header {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
    padding: 0.7rem 1.1rem;
    border-bottom: 1px solid var(--line);
    background: var(--surface);
    flex: 0 0 auto;
  }

  .brand {
    font-weight: 650;
    letter-spacing: -0.01em;
  }

  .tagline {
    color: var(--muted);
    font-size: 0.82rem;
  }

  main {
    flex: 1 1 auto;
    min-height: 0;
  }
</style>
