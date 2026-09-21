<script lang="ts">
  import { onMount } from "svelte";
  import type { DrawEngine } from "@osionos/draw-engine/engine";
  import { downloadBlob } from "./download.ts";
  import MainMenuIcon from "./MainMenuIcon.svelte";
  import { CANVAS_BACKGROUNDS, GRID_SIZES } from "./inspector.ts";
  import type { GridPreference, ThemePreference } from "./theme.ts";

  /**
   * The main menu, rebuilt to Excalidraw's shape.
   *
   * What it replaced was a full-viewport backdrop with `backdrop-filter: blur(4px)`
   * behind a 280px side drawer. Blurring the whole viewport forces the compositor to
   * re-filter everything underneath on every frame it is open, over a canvas that is
   * already the expensive part of the page — which is why it felt slow — and a drawer
   * is the wrong shape for a menu hanging off a toolbar button.
   *
   * This is a compact dropdown anchored under its trigger, with no backdrop at all. The
   * metrics are Excalidraw's, taken from `dropdownMenu/DropdownMenu.scss` at the SHA in
   * `scripts/oracle-sha.txt`: 2rem rows, 0.875rem text, 1rem icons, a 0.625rem gap
   * between icon and label, 0.5rem of horizontal padding, and the shortcut pushed right
   * at half opacity.
   *
   * Their social links are deliberately not here. The feature items are.
   */
  let {
    engine,
    themePreference = "light",
    canvasBackground = null,
    grid,
    onPickTheme,
    onPickCanvasBackground,
    onPickGrid,
    onOpenExport,
    onOpenMermaid,
    onOpenShare,
    onOpenShortcuts,
    onClose,
  }: {
    engine: DrawEngine | null;
    themePreference: ThemePreference;
    canvasBackground: string | null;
    grid: GridPreference;
    onPickTheme: (preference: ThemePreference) => void;
    onPickCanvasBackground: (color: string) => void;
    onPickGrid: (patch: Partial<GridPreference>) => void;
    onOpenExport: () => void;
    onOpenMermaid: () => void;
    onOpenShare: () => void;
    onOpenShortcuts: () => void;
    onClose: () => void;
  } = $props();

  let fileInput: HTMLInputElement;
  let root: HTMLDivElement | undefined;

  /**
   * Focus the menu when it opens, and hand focus back to the trigger when it closes.
   *
   * Without the first, the arrow keys do nothing: the keydown handler lives on the menu,
   * and with focus still on the page body the event never reaches it — so the menu reads
   * as keyboard-navigable and is not. Without the second, dismissing leaves focus
   * nowhere, and the next Tab restarts from the top of the document.
   */
  onMount(() => {
    const returnTo = document.activeElement as HTMLElement | null;
    root?.focus();
    return () => returnTo?.focus?.();
  });

  /** Runs an action and dismisses, which is what selecting a menu item means. */
  function pick(run: () => void): void {
    run();
    onClose();
  }

  export function openFile(): void {
    fileInput?.click();
  }

  function onFileSelected(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file || !engine) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (!engine.loadScene(String(reader.result))) {
        alert("Could not load that file — it is not a drawing this app understands.");
        return;
      }
      onClose();
    };
    reader.readAsText(file);
  }

  function saveToDisk(): void {
    if (!engine) return;
    downloadBlob("drawing.osidraw", new Blob([engine.exportJson()], { type: "application/json" }));
  }

  function resetCanvas(): void {
    if (confirm("Reset the canvas? This clears the drawing and cannot be undone.")) {
      engine?.clear();
    }
  }

  /**
   * Arrow-key navigation between the rows.
   *
   * A `role="menu"` that can only be used with a pointer is a menu in name only, and it
   * is the part most often left out.
   */
  function onKeyDown(event: KeyboardEvent): void {
    const items = [...(root?.querySelectorAll<HTMLElement>("[role='menuitem']") ?? [])];
    if (items.length === 0) return;
    const at = items.indexOf(document.activeElement as HTMLElement);

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      const next =
        at < 0 ? (step > 0 ? 0 : items.length - 1) : (at + step + items.length) % items.length;
      items[next]?.focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      items[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      items[items.length - 1]?.focus();
    }
  }

  const THEMES: Array<{ value: ThemePreference; icon: "sun" | "moon" | "system"; label: string }> =
    [
      { value: "light", icon: "sun", label: "Light" },
      { value: "dark", icon: "moon", label: "Dark" },
      { value: "system", icon: "system", label: "System" },
    ];
</script>

<svelte:window
  onpointerdown={(event) => {
    // Dismiss on a click outside. No backdrop element: one would either swallow the
    // click that should have landed on the canvas, or need a blur to look deliberate.
    if (root && !root.contains(event.target as Node)) onClose();
  }}
/>

<input
  type="file"
  accept=".osidraw,.json,.excalidraw"
  bind:this={fileInput}
  hidden
  onchange={onFileSelected}
/>

<div
  class="dropdown-menu main-menu"
  bind:this={root}
  role="menu"
  aria-orientation="vertical"
  aria-label="Main menu"
  tabindex="-1"
  onkeydown={onKeyDown}
>
  <div class="dropdown-menu-container">
    <button type="button" role="menuitem" class="dropdown-menu-item" onclick={openFile}>
      <MainMenuIcon name="folder" />
      <span class="dropdown-menu-item__text">Open</span>
      <span class="dropdown-menu-item__shortcut">Ctrl+O</span>
    </button>

    <button
      type="button"
      role="menuitem"
      class="dropdown-menu-item"
      onclick={() => pick(saveToDisk)}
    >
      <MainMenuIcon name="disk" />
      <span class="dropdown-menu-item__text">Save to disk</span>
      <span class="dropdown-menu-item__shortcut">Ctrl+S</span>
    </button>

    <button
      type="button"
      role="menuitem"
      class="dropdown-menu-item"
      onclick={() => pick(onOpenExport)}
    >
      <MainMenuIcon name="image" />
      <span class="dropdown-menu-item__text">Export image…</span>
      <span class="dropdown-menu-item__shortcut">Ctrl+Shift+E</span>
    </button>

    <button
      type="button"
      role="menuitem"
      class="dropdown-menu-item"
      onclick={() => pick(onOpenMermaid)}
    >
      <MainMenuIcon name="diagram" />
      <span class="dropdown-menu-item__text">Mermaid to diagram…</span>
    </button>

    <button
      type="button"
      role="menuitem"
      class="dropdown-menu-item"
      onclick={() => pick(onOpenShare)}
    >
      <MainMenuIcon name="collab" />
      <span class="dropdown-menu-item__text">Live collaboration…</span>
    </button>

    <button
      type="button"
      role="menuitem"
      class="dropdown-menu-item"
      onclick={() => pick(onOpenShortcuts)}
    >
      <MainMenuIcon name="help" />
      <span class="dropdown-menu-item__text">Keyboard shortcuts</span>
      <span class="dropdown-menu-item__shortcut">?</span>
    </button>

    <button
      type="button"
      role="menuitem"
      class="dropdown-menu-item"
      onclick={() => pick(resetCanvas)}
    >
      <MainMenuIcon name="trash" />
      <span class="dropdown-menu-item__text">Reset the canvas</span>
    </button>

    <div class="dropdown-menu-separator" role="separator"></div>

    <div class="dropdown-menu-item-bare">
      <span class="dropdown-menu-item__text">Theme</span>
      <div class="RadioGroup" role="radiogroup" aria-label="Theme">
        {#each THEMES as choice (choice.value)}
          <button
            type="button"
            role="radio"
            class="RadioGroup__choice"
            class:active={themePreference === choice.value}
            aria-checked={themePreference === choice.value}
            aria-label={choice.label}
            title={choice.label}
            onclick={() => onPickTheme(choice.value)}
          >
            <MainMenuIcon name={choice.icon} />
          </button>
        {/each}
      </div>
    </div>

    <div class="dropdown-menu-item-bare">
      <span class="dropdown-menu-item__text">Show grid</span>
      <button
        type="button"
        role="switch"
        class="switch"
        class:on={grid.enabled}
        aria-checked={grid.enabled}
        aria-label="Show grid"
        onclick={() => onPickGrid({ enabled: !grid.enabled })}
      >
        <span class="knob"></span>
      </button>
    </div>

    {#if grid.enabled}
      <div class="dropdown-menu-item-bare">
        <span class="dropdown-menu-item__text">Snap to grid</span>
        <button
          type="button"
          role="switch"
          class="switch"
          class:on={grid.snap}
          aria-checked={grid.snap}
          aria-label="Snap to grid"
          onclick={() => onPickGrid({ snap: !grid.snap })}
        >
          <span class="knob"></span>
        </button>
      </div>

      <div class="dropdown-menu-item-bare">
        <span class="dropdown-menu-item__text">Grid size</span>
        <div class="RadioGroup" role="radiogroup" aria-label="Grid size">
          {#each GRID_SIZES as option (option.value)}
            <button
              type="button"
              role="radio"
              class="RadioGroup__choice text"
              class:active={grid.size === option.value}
              aria-checked={grid.size === option.value}
              aria-label={`Grid size ${option.label}`}
              onclick={() => onPickGrid({ size: option.value })}
            >
              {option.label}
            </button>
          {/each}
        </div>
      </div>
    {/if}

    <div class="dropdown-menu-separator" role="separator"></div>

    <div class="dropdown-menu-item-custom">
      <div class="menu-section-label">Canvas background</div>
      <div class="swatches" role="radiogroup" aria-label="Canvas background">
        {#each CANVAS_BACKGROUNDS as color (color)}
          <button
            type="button"
            role="radio"
            class="swatch"
            class:active={canvasBackground === color}
            aria-checked={canvasBackground === color}
            aria-label={color}
            title={color}
            style:--swatch-color={color}
            onclick={() => onPickCanvasBackground(color)}
          ></button>
        {/each}
      </div>
    </div>
  </div>
</div>

<style>
  /* Anchored under the trigger, the way Excalidraw's popper places it. */
  .dropdown-menu {
    position: absolute;
    top: 100%;
    left: 0;
    margin-top: 6px;
    min-width: 232px;
    max-width: 20rem;
    z-index: 110;
  }

  .dropdown-menu-container {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 2px;
    box-sizing: border-box;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 10px;
    box-shadow: var(--shadow-md);
    overflow-y: auto;
    max-height: calc(100svh - 6rem);
  }

  .dropdown-menu-item,
  .dropdown-menu-item-bare {
    display: flex;
    align-items: center;
    column-gap: 0.625rem;
    padding: 0 0.5rem;
    height: 2rem;
    font-size: 0.875rem;
    font-weight: 400;
    font-family: inherit;
    color: var(--fg-strong);
    width: 100%;
    box-sizing: border-box;
  }

  .dropdown-menu-item {
    background: transparent;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    text-align: left;
    flex: 1 0 auto;
  }

  .dropdown-menu-item:hover,
  .dropdown-menu-item:focus-visible {
    background: var(--bg);
    outline: none;
  }

  .dropdown-menu-item:active {
    box-shadow: 0 0 0 1px var(--accent);
  }

  .dropdown-menu-item__text {
    flex: 1 1 auto;
    text-overflow: ellipsis;
    overflow: hidden;
    white-space: nowrap;
  }

  .dropdown-menu-item__shortcut {
    margin-inline-start: auto;
    opacity: 0.5;
    font-size: 0.75rem;
    white-space: nowrap;
  }

  .dropdown-menu-item-bare {
    justify-content: space-between;
  }

  .dropdown-menu-separator {
    height: 1px;
    background: var(--line);
    margin: 6px 0;
    flex: 0 0 auto;
  }

  .RadioGroup {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 2px;
    padding: 3px;
    border-radius: 10px;
    background: var(--surface);
    border: 1px solid var(--line);
  }

  .RadioGroup__choice {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 20px;
    height: 24px;
    padding: 0 0.375rem;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--accent);
    cursor: pointer;
  }

  .RadioGroup__choice.active {
    background: var(--accent);
    color: #ffffff;
  }

  .RadioGroup__choice:not(.active):hover {
    background: var(--bg);
  }

  .dropdown-menu-item-custom {
    margin-top: 0.5rem;
    padding: 0 0.5rem 0.25rem;
  }

  .menu-section-label {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--muted);
    margin-bottom: 0.375rem;
  }

  .swatches {
    display: flex;
    gap: 6px;
  }

  .swatch {
    width: 1.35rem;
    height: 1.35rem;
    padding: 0;
    border-radius: 5px;
    border: 1px solid var(--line);
    background: var(--swatch-color);
    cursor: pointer;
  }

  .swatch.active {
    box-shadow: 0 0 0 2px var(--accent);
  }

  /* A switch, not a checkbox: these are modes that take effect immediately. */
  .switch {
    position: relative;
    width: 32px;
    height: 18px;
    padding: 0;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--bg);
    cursor: pointer;
    flex: 0 0 auto;
    transition: background var(--transition, 120ms);
  }

  .switch.on {
    background: var(--accent);
    border-color: var(--accent);
  }

  .knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--surface);
    transition: transform var(--transition, 120ms);
  }

  .switch.on .knob {
    transform: translateX(14px);
  }

  .RadioGroup__choice.text {
    font-size: 0.75rem;
    font-weight: 600;
    font-family: inherit;
  }
</style>
