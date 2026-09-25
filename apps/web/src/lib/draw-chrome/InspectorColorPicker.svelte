<script lang="ts">
  import { tick, untrack } from "svelte";
  import Icon from "./Icon.svelte";
  import {
    COLOR_HOTKEYS,
    COLOR_LABELS,
    ELEMENT_PALETTE,
    colorNameAndShade,
    defaultShade,
    initialSection,
    isTransparent,
    paletteColor,
    pickerKeyAction,
    readColorInput,
    type ColorKind,
    type PickerSection,
  } from "./colors.ts";

  /**
   * A colour row: five top picks, a divider, and the current colour, which opens
   * Excalidraw's picker (`components/ColorPicker/*.tsx@1118751f`) — most used custom
   * colours, the fifteen-colour grid at the active shade, the shades of the current
   * colour, a hex field and, where the browser has one, an eyedropper.
   *
   * `value` is `null` for a mixed selection: nothing is marked as current, and the
   * trigger shows a slash instead of a colour.
   */
  let {
    label,
    kind,
    value,
    picks,
    hideTransparent = false,
    open,
    customColors,
    onToggle,
    onPick,
  }: {
    label: string;
    kind: ColorKind;
    value: string | null;
    picks: readonly string[];
    /**
     * Hides the transparent swatch — a note's colours are never transparent — rather
     * than dropping it, so every other colour keeps its hotkey (`colorTargets.ts
     * @1118751f:78-83`).
     */
    hideTransparent?: boolean;
    open: boolean;
    /** Asked when the picker opens: the board's most used off-palette colours. */
    customColors: () => string[];
    onToggle: (open: boolean) => void;
    onPick: (color: string) => void;
  } = $props();

  let trigger: HTMLButtonElement | undefined = $state();
  let dialog: HTMLDivElement | undefined = $state();
  let hexInput: HTMLInputElement | undefined = $state();
  let place = $state({ left: 0, top: 0 });
  let section = $state<PickerSection | null>(null);
  let activeShade = $state(0);
  let custom = $state<string[]>([]);
  let hexText = $state("");
  let hexError = $state<string | null>(null);

  const current = $derived(colorNameAndShade(value));
  /** The native eyedropper, where there is one (Chromium). See `docs/reference/console.md`. */
  const canEyeDrop = typeof window !== "undefined" && "EyeDropper" in window;

  /** Set up each time the picker opens, as the oracle's `Picker` mounts afresh. */
  $effect(() => {
    if (!open) return;
    untrack(() => {
      custom = customColors();
      section = initialSection(value, custom);
      activeShade = current?.shade ?? defaultShade(kind);
      hexText = (value ?? "").replace(/^#/, "");
      hexError = null;
      const rect = trigger?.getBoundingClientRect();
      if (rect) {
        // Beside the panel, level with the row, kept on screen.
        const height = 330;
        place = {
          left: rect.right + 16,
          top: Math.max(8, Math.min(rect.top - 12, window.innerHeight - height - 8)),
        };
      }
      void tick().then(() => dialog?.focus());
    });
  });

  // The grid follows the shade of whatever was picked (`Picker.tsx@1118751f:111-116`),
  // and the hex field shows it unless someone is typing there.
  $effect(() => {
    const shade = current?.shade;
    if (shade != null) untrack(() => (activeShade = shade));
    if (document.activeElement !== hexInput) hexText = (value ?? "").replace(/^#/, "");
  });

  function holdFocus(event: MouseEvent): void {
    event.preventDefault();
  }

  function pick(color: string, next: PickerSection | null = section): void {
    section = next;
    onPick(color);
  }

  /** Back to the board, so the next key is a board key again. */
  function close(): void {
    onToggle(false);
    document.querySelector<HTMLElement>('.draw-chrome [role="application"]')?.focus();
  }

  async function eyeDrop(): Promise<void> {
    if (!canEyeDrop) return;
    const Dropper = (
      window as unknown as { EyeDropper: new () => { open(): Promise<{ sRGBHex: string }> } }
    ).EyeDropper;
    try {
      const { sRGBHex } = await new Dropper().open();
      pick(sRGBHex.toLowerCase());
    } catch {
      // Dismissed with Escape: nothing was picked.
    }
  }

  function onKey(event: KeyboardEvent): void {
    const action = pickerKeyAction(event, {
      section,
      color: value,
      customColors: custom,
      activeShade,
    });
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    if (action.kind === "close") close();
    else if (action.kind === "eyedropper") void eyeDrop();
    else if (action.kind === "pick") pick(action.color, action.section);
    else if (action.kind === "section") {
      section = action.section;
      if (action.color) onPick(action.color);
      if (action.section === "hex") hexInput?.focus();
      else dialog?.focus();
    }
  }

  function onHexInput(text: string): void {
    const read = readColorInput(text);
    hexText = text.toLowerCase().trim().replace(/^#/, "");
    hexError = read.error;
    if (read.color) pick(read.color, "hex");
  }

  /** The hex field keeps its keys, except Tab, which moves between sections. */
  function onHexKey(event: KeyboardEvent): void {
    if (event.key === "Tab") return;
    if (event.key === "Escape") {
      event.preventDefault();
      dialog?.focus();
    }
    event.stopPropagation();
  }

  function onWindowPointerDown(event: PointerEvent): void {
    if (!open) return;
    const target = event.target as Node | null;
    if (target && (dialog?.contains(target) || trigger?.contains(target))) return;
    onToggle(false);
  }
</script>

<svelte:window onpointerdown={onWindowPointerDown} />

<div class="swatches">
  <div class="picks">
    {#each picks as color (color)}
      <button
        type="button"
        class="dot"
        class:transparent={isTransparent(color)}
        class:on={value === color}
        aria-label={color}
        aria-pressed={value === color}
        style:background={isTransparent(color) ? undefined : color}
        onmousedown={holdFocus}
        onclick={() => onPick(color)}
      ></button>
    {/each}
  </div>

  <div class="divider"></div>

  <button
    bind:this={trigger}
    type="button"
    class="dot current"
    class:transparent={value !== null && isTransparent(value)}
    class:mixed={value === null}
    aria-label={label}
    aria-haspopup="dialog"
    aria-expanded={open}
    title={value === null ? `${label}: mixed` : `${label}: ${value}`}
    style:background={value !== null && !isTransparent(value) ? value : undefined}
    onmousedown={holdFocus}
    onclick={() => onToggle(!open)}
  ></button>
</div>

{#if open}
  <div
    bind:this={dialog}
    class="picker draw-panel"
    role="dialog"
    aria-label={`${label} colour picker`}
    tabindex="-1"
    style:left={`${place.left}px`}
    style:top={`${place.top}px`}
    onkeydown={onKey}
  >
    {#if custom.length}
      <div class="heading">Most used custom colors</div>
      <div class="grid">
        {#each custom as color, index (color)}
          <button
            type="button"
            class="cell"
            class:active={value === color}
            aria-label={`${color} — ${index + 1}`}
            title={color}
            style:background={color}
            onmousedown={holdFocus}
            onclick={() => pick(color, "custom")}><span class="hotkey">{index + 1}</span></button
          >
        {/each}
      </div>
    {/if}

    <div class="heading">Colors</div>
    <div class="grid">
      {#each ELEMENT_PALETTE as [name, entry], index (name)}
        {@const color = paletteColor(entry, activeShade)}
        <button
          type="button"
          class="cell"
          hidden={hideTransparent && isTransparent(color)}
          class:transparent={isTransparent(color)}
          class:active={current?.name === name}
          aria-label={`${COLOR_LABELS[name]} — ${COLOR_HOTKEYS[index]}`}
          title={`${COLOR_LABELS[name]}${color.startsWith("#") ? ` ${color}` : ""} — ${COLOR_HOTKEYS[index]}`}
          style:background={isTransparent(color) ? undefined : color}
          onmousedown={holdFocus}
          onclick={() => pick(color, "baseColors")}
          ><span class="hotkey">{COLOR_HOTKEYS[index]}</span></button
        >
      {/each}
    </div>

    <div class="heading">Shades</div>
    {#if current && current.shade !== null}
      {@const shades = (ELEMENT_PALETTE[current.index]?.[1] ?? []) as readonly string[]}
      <div class="grid">
        {#each shades as color, index (color)}
          <button
            type="button"
            class="cell"
            class:active={index === current.shade}
            aria-label="Shade"
            title={`${current.name} - ${index + 1}`}
            style:background={color}
            onmousedown={holdFocus}
            onclick={() => pick(color, "shades")}><span class="hotkey">⇧{index + 1}</span></button
          >
        {/each}
      </div>
    {:else}
      <div class="none">No shades available for this color</div>
    {/if}

    <div class="heading">Hex code</div>
    <div class="hex" class:error={hexError !== null}>
      <span aria-hidden="true">#</span>
      <input
        bind:this={hexInput}
        aria-label="Hex code"
        aria-invalid={hexError !== null}
        spellcheck="false"
        value={hexText}
        oninput={(event) => onHexInput(event.currentTarget.value)}
        onkeydown={onHexKey}
        onfocus={() => (section = "hex")}
        onblur={() => {
          hexText = (value ?? "").replace(/^#/, "");
          hexError = null;
        }}
      />
      {#if canEyeDrop}
        <button
          type="button"
          class="dropper"
          aria-label="Pick color from canvas"
          title="Pick color from canvas — I"
          onmousedown={holdFocus}
          onclick={() => void eyeDrop()}
        >
          <Icon name="eyeDropper" size={16} />
        </button>
      {/if}
    </div>
    {#if hexError}
      <div class="message" role="alert">{hexError}</div>
    {/if}
  </div>
{/if}

<style>
  .swatches {
    display: flex;
    align-items: center;
    gap: 8px;
    /* Never wraps: the divider and the current colour belong on the same line. */
    flex-wrap: nowrap;
  }

  .picks {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex: 1 1 auto;
    gap: 4px;
  }

  .dot {
    width: 1.375rem;
    height: 1.375rem;
    flex: 0 0 auto;
    padding: 0;
    border-radius: 4px;
    border: 1px solid var(--line);
    cursor: pointer;
  }

  .dot.on {
    box-shadow:
      0 0 0 1px var(--surface),
      0 0 0 3px var(--accent);
  }

  .transparent {
    background: repeating-conic-gradient(#c0c0c0 0% 25%, #fff 0% 50%) 50% / 8px 8px;
  }

  /* A mixed selection has no one colour to show. */
  .mixed {
    background: linear-gradient(
      to top right,
      var(--surface) calc(50% - 1px),
      var(--muted) calc(50% - 1px),
      var(--muted) calc(50% + 1px),
      var(--surface) calc(50% + 1px)
    );
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
    width: 13.5rem;
    padding: 12px;
    border-radius: 10px;
    box-shadow: var(--shadow-md);
    outline: none;
  }

  .heading {
    margin: 10px 0 6px;
    font-size: 11px;
    font-weight: 600;
    color: var(--muted);
  }

  .heading:first-child {
    margin-top: 0;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(5, 1.875rem);
    justify-content: space-between;
    row-gap: 6px;
  }

  .cell {
    position: relative;
    width: 1.875rem;
    height: 1.875rem;
    padding: 0;
    border-radius: 6px;
    border: 1px solid var(--line);
    cursor: pointer;
  }

  .cell.active {
    box-shadow:
      0 0 0 1px var(--surface),
      0 0 0 3px var(--accent);
  }

  .hotkey {
    position: absolute;
    right: 2px;
    bottom: 1px;
    font-size: 9px;
    line-height: 1;
    color: #1e1e1e;
    opacity: 0.6;
  }

  .none {
    font-size: 11px;
    color: var(--muted);
  }

  .hex {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 8px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--surface);
  }

  .hex.error {
    border-color: #e03131;
  }

  .hex span {
    color: var(--muted);
  }

  .hex input {
    flex: 1;
    min-width: 0;
    border: 0;
    padding: 0;
    background: transparent;
    color: var(--fg-strong);
    font: inherit;
    outline: none;
  }

  .dropper {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--fg-strong);
    cursor: pointer;
  }

  .dropper:hover {
    background: var(--bg);
  }

  .message {
    margin-top: 4px;
    font-size: 11px;
    color: #e03131;
  }
</style>
