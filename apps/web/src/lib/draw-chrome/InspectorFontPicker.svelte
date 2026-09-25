<script lang="ts">
  import { tick, untrack } from "svelte";
  import Icon from "./Icon.svelte";
  import { QUICK_FONTS, fontGroups, fontLabel, fontPickerKey, type FontChoice } from "./fonts.ts";

  /**
   * The font family row: three quick picks, a divider, and a trigger opening the list of
   * families — Excalidraw's FontPicker (`components/FontPicker/*.tsx@1118751f`). The list
   * puts the families the board uses first, is searched as it is typed into, walked with
   * the arrow keys, and shows a hovered family on the canvas before it is picked.
   *
   * Divergence: the oracle's quick picks can be rearranged by dragging families onto
   * them (`fontTopPicksDnD.tsx@1118751f`); these are the three it starts with.
   *
   * `value` is `null` for a mixed selection: no quick pick is checked, nothing in the
   * list is marked, and the trigger's title says "mixed".
   */
  let {
    value,
    open,
    sceneFamilies,
    stackOf,
    onToggle,
    onPick,
    onPreview,
  }: {
    value: number | null;
    open: boolean;
    /** Asked when the list opens: the families the board's texts are drawn in. */
    sceneFamilies: () => number[];
    /** The CSS stack a family is drawn in, so each is listed in its own face. */
    stackOf: (id: number) => string;
    onToggle: (open: boolean) => void;
    onPick: (id: number) => void;
    /** Shows a family on the selection without committing it; `null` takes it back. */
    onPreview: (id: number | null) => void;
  } = $props();

  let trigger: HTMLButtonElement | undefined = $state();
  let dialog: HTMLDivElement | undefined = $state();
  let searchInput: HTMLInputElement | undefined = $state();
  let place = $state({ left: 0, top: 0 });
  let search = $state("");
  let hovered = $state<number | null>(null);
  let inScene = $state<number[]>([]);
  /**
   * The family as it was when the list opened. A hovered family is drawn on the canvas,
   * so the selection reads as that one while it is; the list and the quick picks go on
   * showing what is actually chosen, as the oracle's cached elements do
   * (`actionProperties.tsx@1118751f:1395-1405`).
   */
  let chosen = $state<number | null>(null);

  const shown = $derived(open ? chosen : value);
  const groups = $derived(fontGroups(inScene, search));
  const listed = $derived([...groups.inScene, ...groups.available].map((font) => font.id));

  /** Set up each time the list opens, and the preview taken back each time it closes. */
  $effect(() => {
    if (!open) return;
    untrack(() => {
      chosen = value;
      search = "";
      hovered = null;
      inScene = sceneFamilies();
      const rect = trigger?.getBoundingClientRect();
      if (rect) {
        // Beside the panel, level with the row, kept on screen.
        const height = 320;
        place = {
          left: rect.right + 16,
          top: Math.max(8, Math.min(rect.top - 12, window.innerHeight - height - 8)),
        };
      }
      void tick().then(() => searchInput?.focus());
    });
    return () => {
      hovered = null;
      onPreview(null);
    };
  });

  function holdFocus(event: MouseEvent): void {
    event.preventDefault();
  }

  function hover(id: number): void {
    if (hovered === id) return;
    hovered = id;
    onPreview(id);
  }

  function leave(): void {
    if (hovered === null) return;
    hovered = null;
    onPreview(null);
  }

  /** Back to the board, so the next key is a board key again. */
  function close(): void {
    onToggle(false);
    document.querySelector<HTMLElement>('.draw-chrome [role="application"]')?.focus();
  }

  function pick(id: number): void {
    onPick(id);
    close();
  }

  function onKey(event: KeyboardEvent): void {
    // The oracle walks from the chosen family when nothing is hovered (`FontPickerList.tsx@1118751f:189-196`).
    const action = fontPickerKey(event, hovered ?? chosen, listed);
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    if (action.kind === "focusSearch") searchInput?.focus();
    else if (action.kind === "close") close();
    else if (action.kind === "select") pick(action.id);
    else if (action.kind === "hover") {
      hover(action.id);
      void tick().then(() =>
        dialog?.querySelector('[data-hovered="true"]')?.scrollIntoView({ block: "nearest" }),
      );
    }
  }

  /** A search hovers the first family found when the one hovered is gone (`:198-206`). */
  function onSearch(text: string): void {
    search = text;
    const current = hovered ?? chosen;
    if (!text.trim() || (current !== null && listed.includes(current))) return;
    const [first] = listed;
    if (first === undefined) leave();
    else hover(first);
  }

  function onWindowPointerDown(event: PointerEvent): void {
    if (!open) return;
    const target = event.target as Node | null;
    if (target && (dialog?.contains(target) || trigger?.contains(target))) return;
    onToggle(false);
  }
</script>

<svelte:window onpointerdown={onWindowPointerDown} />

{#snippet item(font: FontChoice)}
  <button
    type="button"
    class="item"
    class:chosen={font.id === shown}
    data-hovered={font.id === hovered}
    aria-label={font.label}
    aria-current={font.id === shown}
    title={font.label}
    onmousedown={holdFocus}
    onmousemove={() => hover(font.id)}
    onclick={() => pick(font.id)}
  >
    <Icon name={font.icon} size={16} />
    <span class="name" style:font-family={stackOf(font.id)}>{font.label}</span>
    {#if font.deprecated}<span class="badge" aria-hidden="true">old</span>{/if}
  </button>
{/snippet}

<div class="fonts">
  <div class="picks" role="radiogroup" aria-label="Font family">
    {#each QUICK_FONTS as font (font.id)}
      <button
        type="button"
        role="radio"
        class:on={shown === font.id}
        aria-checked={shown === font.id}
        aria-label={font.label}
        title={font.label}
        onmousedown={holdFocus}
        onclick={() => onPick(font.id)}
      >
        <Icon name={font.icon} size={14} />
      </button>
    {/each}
  </div>

  <div class="divider"></div>

  <button
    bind:this={trigger}
    type="button"
    class="trigger"
    class:on={open}
    aria-label="Show font picker"
    aria-haspopup="dialog"
    aria-expanded={open}
    title={`Font family: ${fontLabel(shown)}`}
    onmousedown={holdFocus}
    onclick={() => onToggle(!open)}
  >
    <Icon name="text" size={14} />
  </button>
</div>

{#if open}
  <div
    bind:this={dialog}
    class="picker draw-panel"
    role="dialog"
    aria-label="Font picker"
    tabindex="-1"
    style:left={`${place.left}px`}
    style:top={`${place.top}px`}
    onkeydown={onKey}
    onpointerleave={leave}
  >
    <input
      bind:this={searchInput}
      class="search"
      type="text"
      placeholder="Quick search"
      aria-label="Quick search"
      spellcheck="false"
      value={search}
      oninput={(event) => onSearch(event.currentTarget.value)}
    />
    <div class="list">
      {#if groups.inScene.length}
        <div class="group" role="group" aria-label="In this scene">
          <div class="heading">In this scene</div>
          {#each groups.inScene as font (font.id)}{@render item(font)}{/each}
        </div>
      {/if}
      {#if groups.available.length}
        <div class="group" role="group" aria-label="Available fonts">
          <div class="heading">Available fonts</div>
          {#each groups.available as font (font.id)}{@render item(font)}{/each}
        </div>
      {/if}
      {#if listed.length === 0}
        <div class="none">No fonts found</div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .fonts {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .picks {
    display: flex;
    flex: 1 1 auto;
    gap: 4px;
  }

  .picks button,
  .trigger {
    flex: 1;
    height: 30px;
    display: grid;
    place-items: center;
    padding: 0;
    border-radius: 6px;
    border: 1px solid var(--line);
    background: var(--surface);
    color: var(--ink);
    cursor: pointer;
  }

  .trigger {
    flex: 0 0 30px;
  }

  .picks button.on,
  .trigger.on {
    color: var(--accent);
    background: var(--accent-subtle);
  }

  .divider {
    width: 1px;
    height: 1rem;
    flex: 0 0 auto;
    background: var(--line);
  }

  .picker {
    position: fixed;
    z-index: 30;
    width: 15rem;
    padding: 8px;
    border-radius: 10px;
    box-shadow: var(--shadow-md);
    outline: none;
  }

  .search {
    width: 100%;
    box-sizing: border-box;
    height: 30px;
    padding: 0 8px;
    margin-bottom: 6px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--surface);
    color: var(--fg-strong);
    font: inherit;
    outline: none;
  }

  .list {
    max-height: 16rem;
    overflow-y: auto;
  }

  .heading {
    margin: 6px 4px 4px;
    font-size: 11px;
    font-weight: 600;
    color: var(--muted);
  }

  .item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    height: 32px;
    padding: 0 8px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--fg-strong);
    text-align: left;
    cursor: pointer;
  }

  .item[data-hovered="true"] {
    background: var(--bg);
  }

  .item.chosen {
    color: var(--accent);
    background: var(--accent-subtle);
  }

  .name {
    flex: 1;
    font-size: 14px;
  }

  .badge {
    padding: 1px 6px;
    border-radius: 8px;
    font-size: 10px;
    color: var(--muted);
    background: var(--bg);
  }

  .none {
    padding: 8px;
    font-size: 12px;
    color: var(--muted);
  }
</style>
