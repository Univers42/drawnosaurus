<script lang="ts">
  import Icon from "./Icon.svelte";
  import { DRAW_TOOLS, type ExtendedTool } from "./tools.ts";

  let {
    active,
    toolLocked,
    onSelect,
    onToggleToolLock,
  }: {
    active: ExtendedTool;
    toolLocked: boolean;
    onSelect: (tool: ExtendedTool) => void;
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
      <span class="hotkey-badge">{entry.hotkey}</span>
    </button>
  {/each}
</div>

<style>
  .bar {
    position: absolute;
    top: 14px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 3px;
    padding: 4px;
    border-radius: 10px;
    z-index: 20;
    box-shadow: var(--shadow-md);
  }

  button {
    position: relative;
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    border-radius: 8px;
    color: var(--ink);
    transition: all 0.12s ease;
  }

  button:hover:not(.active) {
    background: var(--bg);
  }

  button.active {
    color: var(--accent);
    background: var(--accent-subtle);
  }

  .hotkey-badge {
    position: absolute;
    right: 2px;
    bottom: 1px;
    font-size: 9px;
    font-weight: 700;
    opacity: 0.6;
    pointer-events: none;
    line-height: 1;
  }

  .rule {
    width: 1px;
    height: 20px;
    margin: 0 2px;
    background: var(--line);
  }
</style>
