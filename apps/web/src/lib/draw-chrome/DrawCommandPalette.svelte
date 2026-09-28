<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { paletteGroups, type Command } from "./commandPalette.ts";
  import { takeFocus } from "./focusHandback.ts";

  let {
    commands,
    recentId = null,
    onClose,
    onRun,
  }: {
    commands: Command[];
    /** The one command last run, kept by whoever owns this dialog so it outlives the
     *  dialog itself — the oracle's `lastUsedPaletteItem` is a module-level atom for the
     *  same reason (`CommandPalette.tsx@1118751f:85`). */
    recentId?: string | null;
    onClose: () => void;
    /** Told which command ran, and not which was highlighted. */
    onRun?: (id: string) => void;
  } = $props();

  let query = $state("");
  let activeIndex = $state(0);
  let inputEl: HTMLInputElement | undefined = $state();
  let root: HTMLElement | undefined = $state();
  /** The hand-back `takeFocus` returns, kept for the teardown's own condition. */
  let handBack: (() => void) | null = null;

  const groups = $derived(paletteGroups(commands, query, recentId));
  const flat = $derived(groups.flatMap((group) => group.commands));
  const active = $derived(flat[activeIndex]);

  onMount(() => {
    // A real widget, not a click target: whatever had focus — the board, most often —
    // gets it back on close, the combobox/listbox pattern's own contract.
    handBack = takeFocus(inputEl);
  });

  onDestroy(() => {
    // Unless the command gave focus somewhere to go — a dialog it opened, focusing its
    // own field — which handing it back would take away from under the keyboard.
    const now = document.activeElement;
    if (now === null || now === document.body || root?.contains(now)) handBack?.();
  });

  function runActive(): void {
    const command = flat[activeIndex];
    if (!command) return;
    command.run();
    // Running a command is what makes it recent. Hovering one (`onmouseenter`, below) and
    // arrowing onto one move the highlight and nothing else, which is the oracle's own
    // split: `executeCommand` fills the memory after `perform`
    // (`CommandPalette.tsx@1118751f:665`), while the highlight never reaches it (`:933`).
    onRun?.(command.id);
    onClose();
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      activeIndex = flat.length === 0 ? 0 : (activeIndex + 1) % flat.length;
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      activeIndex = flat.length === 0 ? 0 : (activeIndex - 1 + flat.length) % flat.length;
    } else if (event.key === "Enter") {
      event.preventDefault();
      runActive();
    } else if (event.key === "Escape") {
      // DrawModals' own window-level Escape handler also closes this layer; caught here
      // too so the palette works the same mounted on its own, and so it never falls
      // through to the board underneath (a stray "e" would pick the eraser).
      event.preventDefault();
      onClose();
    }
  }
</script>

<div
  bind:this={root}
  class="modal-backdrop"
  role="dialog"
  aria-modal="true"
  aria-label="Command palette"
>
  <div class="palette-card">
    <input
      bind:this={inputEl}
      bind:value={query}
      oninput={() => (activeIndex = 0)}
      onkeydown={onKeydown}
      type="text"
      role="combobox"
      aria-label="Command palette"
      aria-expanded="true"
      aria-controls="palette-listbox"
      aria-autocomplete="list"
      aria-activedescendant={active ? `palette-option-${active.id}` : undefined}
      placeholder="Type a command…"
      class="palette-input"
    />
    <div id="palette-listbox" role="listbox" class="palette-list" aria-label="Commands">
      {#each groups as group (group.category)}
        <div class="palette-group">
          {#if group.category !== "Results"}
            <div class="palette-group-label">{group.category}</div>
          {/if}
          {#each group.commands as command (command.id)}
            {@const index = flat.indexOf(command)}
            <button
              type="button"
              id={`palette-option-${command.id}`}
              role="option"
              aria-selected={index === activeIndex}
              class="palette-item"
              class:active={index === activeIndex}
              onmouseenter={() => (activeIndex = index)}
              onclick={() => {
                activeIndex = index;
                runActive();
              }}
            >
              <span class="palette-item__label">{command.label}</span>
              {#if command.shortcut}
                <kbd class="palette-item__shortcut">{command.shortcut}</kbd>
              {/if}
            </button>
          {/each}
        </div>
      {/each}
      {#if flat.length === 0}
        <div class="palette-empty">No matching commands</div>
      {/if}
    </div>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    display: grid;
    place-items: start center;
    padding-top: 12vh;
    z-index: 100;
    backdrop-filter: blur(3px);
  }

  .palette-card {
    background: var(--surface);
    color: var(--ink);
    border: 1px solid var(--line);
    border-radius: 14px;
    width: 560px;
    max-width: 92vw;
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    box-shadow: var(--shadow-lg);
    overflow: hidden;
  }

  .palette-input {
    border: none;
    border-bottom: 1px solid var(--line);
    padding: 0.875rem 1rem;
    font-size: 0.9375rem;
    font-family: inherit;
    color: var(--ink);
    background: transparent;
    outline: none;
  }

  .palette-list {
    overflow-y: auto;
    padding: 0.375rem;
  }

  .palette-group-label {
    padding: 0.5rem 0.625rem 0.25rem;
    font-size: 0.6875rem;
    font-weight: 700;
    color: var(--accent);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .palette-item {
    display: flex;
    align-items: center;
    column-gap: 0.625rem;
    width: 100%;
    box-sizing: border-box;
    padding: 0 0.625rem;
    height: 2rem;
    font-size: 0.875rem;
    font-family: inherit;
    color: var(--fg-strong);
    background: transparent;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    text-align: left;
  }

  .palette-item.active {
    background: var(--bg);
  }

  .palette-item__label {
    flex: 1 1 auto;
    text-overflow: ellipsis;
    overflow: hidden;
    white-space: nowrap;
  }

  .palette-item__shortcut {
    margin-inline-start: auto;
    opacity: 0.5;
    font-size: 0.75rem;
    white-space: nowrap;
    font-family: inherit;
  }

  .palette-empty {
    padding: 0.75rem;
    font-size: 0.8125rem;
    color: var(--muted);
    text-align: center;
  }
</style>
