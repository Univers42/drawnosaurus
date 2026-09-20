<script lang="ts">
  import type { DrawTool } from "@osionos/draw-engine/types";
  import Icon from "./Icon.svelte";
  import { DRAW_TOOLS } from "./tools.ts";

  let {
    active,
    toolLocked,
    onSelect,
    onToggleToolLock,
  }: {
    active: DrawTool;
    toolLocked: boolean;
    onSelect: (tool: DrawTool) => void;
    onToggleToolLock: () => void;
  } = $props();

  function holdFocus(event: MouseEvent): void {
    event.preventDefault();
  }
</script>

<div class="draw-panel bar" role="toolbar" aria-label="Drawing tools">
  <button
    type="button"
    onmousedown={holdFocus}
    aria-label={`Keep tool active after drawing (Q) — ${toolLocked ? "on" : "off"}`}
    aria-pressed={toolLocked}
    title="Keep tool active — Q"
    class:active={toolLocked}
    onclick={onToggleToolLock}
  >
    <Icon name={toolLocked ? "lock" : "lockOpen"} size={16} />
  </button>
  <div class="rule" aria-hidden="true"></div>
  {#each DRAW_TOOLS as entry (entry.tool)}
    <button
      type="button"
      onmousedown={holdFocus}
      aria-label={`${entry.label} (${entry.hotkey})`}
      aria-pressed={active === entry.tool}
      title={`${entry.label} — ${entry.hotkey}`}
      class:active={active === entry.tool}
      onclick={() => onSelect(entry.tool)}
    >
      <Icon name={entry.icon} size={18} />
    </button>
  {/each}
</div>

<style>
  .bar {
    position: absolute;
    top: 16px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    gap: 4px;
    padding: 6px;
    border-radius: 12px;
    z-index: 2;
  }

  button {
    width: 44px;
    height: 44px;
    display: grid;
    place-items: center;
  }

  button.active {
    color: var(--accent);
    background: var(--accent-subtle);
  }

  .rule {
    width: 1px;
    align-self: stretch;
    margin: 6px 2px;
    background: var(--line);
  }
</style>
