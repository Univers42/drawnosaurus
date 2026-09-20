<script lang="ts">
  import type { Arrowhead } from "@osionos/draw-engine/types";
  import { ARROWHEAD_GLYPH, ARROWHEAD_KINDS, ARROWHEAD_LABEL } from "./menu.ts";

  let {
    title,
    active,
    onSelect,
  }: {
    title: string;
    active: Arrowhead;
    onSelect: (kind: Arrowhead) => void;
  } = $props();
</script>

<div class="extremity">
  <div class="cap">{title}</div>
  <div class="kinds">
    {#each ARROWHEAD_KINDS as kind (kind)}
      <button
        type="button"
        aria-label={`${title}: ${ARROWHEAD_LABEL[kind]}`}
        aria-pressed={active === kind}
        title={ARROWHEAD_LABEL[kind]}
        class:on={active === kind}
        onclick={() => onSelect(kind)}
      >
        {ARROWHEAD_GLYPH[kind]}
      </button>
    {/each}
  </div>
</div>

<style>
  .extremity {
    padding: 6px 8px;
  }

  .cap {
    padding: 0 4px 4px;
    font-size: 11px;
    font-weight: 600;
    color: var(--muted);
  }

  .kinds {
    display: flex;
    gap: 4px;
  }

  .kinds button {
    width: 32px;
    height: 32px;
    border: 1px solid var(--line);
    border-radius: 6px;
    font-size: 14px;
  }

  .kinds button.on {
    border-color: var(--accent);
    color: var(--accent);
    background: var(--accent-subtle);
  }
</style>
