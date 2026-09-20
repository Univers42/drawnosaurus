<script lang="ts">
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import "../app.css";

  let { children } = $props();
  const onBoard = $derived(page.url.pathname.includes("/boards/"));
  let dark = $state(false);

  function toggleTheme(): void {
    dark = !dark;
    if (typeof document !== "undefined") {
      document.documentElement.classList.toggle("dark", dark);
    }
  }
</script>

<div class="shell">
  {#if !onBoard}
    <header>
      <div class="brand-row">
        <a class="brand" href={resolve("/")}>🦕 drawnosaurus</a>
        <span class="tagline">Collaborative canvas · Rust + WASM</span>
      </div>
      <button type="button" class="theme-btn" onclick={toggleTheme} aria-label="Toggle theme">
        {dark ? "☀️ Light" : "🌙 Dark"}
      </button>
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
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1.5rem;
    border-bottom: 1px solid var(--line);
    background: var(--surface);
    flex: 0 0 auto;
    transition:
      background var(--transition),
      border-color var(--transition);
  }

  .brand-row {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
  }

  .brand {
    font-weight: 700;
    font-size: 1.1rem;
    color: var(--ink);
    text-decoration: none;
    letter-spacing: -0.01em;
  }

  .tagline {
    color: var(--muted);
    font-size: 0.82rem;
  }

  .theme-btn {
    padding: 0.35rem 0.75rem;
    font-size: 0.85rem;
    border-radius: var(--radius);
  }

  main {
    flex: 1 1 auto;
    min-height: 0;
  }
</style>
