<script lang="ts">
  /**
   * The tool bar: the common tools in a row, the occasional ones behind a button.
   *
   * The split is not cosmetic. A bar is a row of identical squares, so finding one in it
   * is a scanning problem and every tool added makes every other tool harder to hit —
   * and past a point the row stops fitting on a laptop at all, which is exactly what
   * happened: the newest tools were off the end of the bar and invisible.
   *
   * Shortcuts deliberately do not route through this menu. The engine owns the keymap, so
   * every tool in the dropdown is one key away whether the menu is open, closed, or never
   * discovered — the menu is for finding them, not for reaching them.
   */
  import Icon from "./Icon.svelte";
  import { DRAW_TOOLS, EXTRA_TOOLS, isExtraTool, toolDef, type ExtendedTool } from "./tools.ts";

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

  let open = $state(false);
  let root: HTMLDivElement | undefined = $state();
  let trigger: HTMLButtonElement | undefined = $state();

  /**
   * The trigger wears the active extra tool's own icon.
   *
   * Otherwise picking "Frame" leaves the bar looking exactly as it did, and the only
   * sign of which tool is live is the cursor.
   */
  const activeExtra = $derived(isExtraTool(active) ? toolDef(active) : undefined);

  function holdFocus(event: MouseEvent): void {
    event.preventDefault();
  }

  function choose(tool: ExtendedTool): void {
    open = false;
    onSelect(tool);
  }

  function onWindowPointerDown(event: PointerEvent): void {
    if (!open) return;
    if (root && !root.contains(event.target as Node)) open = false;
  }

  function onMenuKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.stopPropagation();
      open = false;
      trigger?.focus();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = Array.from(root?.querySelectorAll<HTMLElement>(".menu-item") ?? []);
    if (items.length === 0) return;
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = event.key === "ArrowDown" ? at + 1 : at - 1;
    items[(next + items.length) % items.length]?.focus();
  }
</script>

<svelte:window onpointerdown={onWindowPointerDown} />

<div class="draw-panel bar" role="toolbar" aria-label="Drawing tools" bind:this={root}>
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

  <div class="rule" aria-hidden="true"></div>

  <div class="more" onkeydown={onMenuKeydown} role="none">
    <button
      type="button"
      bind:this={trigger}
      onmousedown={holdFocus}
      class="trigger"
      class:active={!!activeExtra}
      aria-label={activeExtra ? `More tools — ${activeExtra.label} selected` : "More tools"}
      aria-haspopup="menu"
      aria-expanded={open}
      title="More tools"
      onclick={() => (open = !open)}
    >
      <Icon name={activeExtra?.icon ?? "more"} size={18} />
      <span class="caret" aria-hidden="true"></span>
    </button>

    {#if open}
      <div class="menu draw-panel" role="menu" aria-label="More tools">
        {#each EXTRA_TOOLS as entry (entry.tool)}
          <button
            type="button"
            class="menu-item"
            role="menuitemradio"
            aria-checked={active === entry.tool}
            class:on={active === entry.tool}
            onmousedown={holdFocus}
            onclick={() => choose(entry.tool)}
          >
            <Icon name={entry.icon} size={16} />
            <span class="name">{entry.label}</span>
            <kbd>{entry.hotkey}</kbd>
          </button>
        {/each}
      </div>
    {/if}
  </div>
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

  .more {
    position: relative;
    display: flex;
  }

  /* A small triangle in the corner, which is the near-universal sign that a button
     opens something rather than doing something. */
  .caret {
    position: absolute;
    right: 3px;
    bottom: 3px;
    width: 0;
    height: 0;
    border-left: 4px solid transparent;
    border-top: 4px solid currentColor;
    opacity: 0.5;
  }

  .trigger.active .caret {
    opacity: 0.9;
  }

  .menu {
    position: absolute;
    top: calc(100% + 8px);
    /* Right-aligned: the trigger is the last thing on the bar, so a left-aligned menu
       would hang off the edge of a narrow window. */
    right: 0;
    min-width: 232px;
    padding: 4px;
    border-radius: 10px;
    box-shadow: var(--shadow-md);
    display: flex;
    flex-direction: column;
    gap: 1px;
    z-index: 30;
  }

  .menu-item {
    width: 100%;
    height: 2rem;
    display: flex;
    align-items: center;
    gap: 0.625rem;
    padding: 0 0.5rem;
    border-radius: 6px;
    font-size: 0.875rem;
    color: var(--ink);
    text-align: left;
  }

  .menu-item:hover,
  .menu-item:focus-visible {
    background: var(--bg-hover);
  }

  .menu-item.on {
    color: var(--accent);
    background: var(--accent-subtle);
  }

  .name {
    flex: 1 1 auto;
  }

  kbd {
    font-family: ui-monospace, SFMono-Regular, monospace;
    font-size: 0.6875rem;
    opacity: 0.55;
    /* The key is a reminder, not a target: it is why the menu need not be opened again. */
    pointer-events: none;
  }
</style>
