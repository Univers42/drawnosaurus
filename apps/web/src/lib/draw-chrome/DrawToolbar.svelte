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
    padding: 5px;
    border-radius: 12px;
    z-index: 20;
    box-shadow: var(--shadow-md);
    transition: box-shadow var(--transition);
  }

  button {
    position: relative;
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    border-radius: 8px;
    color: var(--ink);
    transition:
      background var(--transition),
      color var(--transition),
      transform 0.1s ease;
  }

  button:active {
    transform: scale(0.92);
  }

  button:hover:not(.active) {
    background: var(--bg-hover);
  }

  button.active {
    color: var(--accent);
    background: var(--accent-subtle);
    font-weight: 600;
  }

  .hotkey-badge {
    position: absolute;
    right: 3px;
    bottom: 2px;
    font-size: 9px;
    font-weight: 700;
    opacity: 0.55;
    pointer-events: none;
    line-height: 1;
    font-family: ui-monospace, SFMono-Regular, monospace;
  }

  button.active .hotkey-badge {
    opacity: 0.9;
    color: var(--accent);
  }

  .rule {
    width: 1px;
    height: 22px;
    margin: 0 3px;
    background: var(--line);
  }
</style>
