<script lang="ts">
  import type { Snippet } from "svelte";

  let { label, children }: { label: string; children: Snippet } = $props();
</script>

<div class="row">
  <span>{label}</span>
  {@render children()}
</div>

<style>
  .row {
    display: grid;
    gap: 6px;
    margin-bottom: 12px;
  }

  span {
    font-size: 11px;
    font-weight: 600;
    color: var(--muted);
  }
</style>
