<script lang="ts">
  /**
   * The phone's compact style strip: what a selection can be made of, in one row.
   *
   * Port of the oracle's `MobileShapeActions` (`packages/excalidraw/components/Actions.tsx
   * @1118751f:731-880`): the properties the selection has, one button each, with the
   * rows that travel together coalesced into one popover — the oracle's own reason for
   * combining them — and undo and redo always at the right end. Width decides where
   * duplicate and delete sit: promoted onto the row when there is room, and left in the
   * layer popover when there is not (`mobileActions.ts` holds the plan and its
   * thresholds; this file draws it).
   *
   * Divergence, deliberate: the oracle's strip appears with a selection, while this one
   * is always on the phone's dock. With nothing selected the two colour buttons act on
   * the *next* shape — the engine's own next style, the way Excalidraw's canvas
   * properties work — so a thumb can pick a look before it draws. Everything else on
   * the row is the selection's, and appears with it.
   */
  import type { SelectionStyle, StylePatch } from "@osionos/draw-engine/types";
  import type { DrawEngine } from "@osionos/draw-engine/engine";
  import Icon from "./Icon.svelte";
  import type { IconName } from "./icons.ts";
  import InspectorRow from "./InspectorRow.svelte";
  import InspectorColorPicker from "./InspectorColorPicker.svelte";
  import InspectorFontPicker from "./InspectorFontPicker.svelte";
  import ShapeActionRows from "./ShapeActionRows.svelte";
  import { mobileActionBarPlan, type StripItem } from "./mobileActions.ts";
  import type { ShapeActions } from "./shapeActions.ts";
  import { colorRow, type ThemeMode } from "./inspector.ts";
  import { loadFontFamily } from "./fonts.ts";
  import { mostUsedCustomColors, type ColorKind } from "./colors.ts";

  let {
    summary,
    can,
    engine,
    themeMode = "light",
    onApply,
    onPreview,
    run,
  }: {
    summary: SelectionStyle;
    /** Which properties apply, as the panel reads them. */
    can: ShapeActions;
    engine: DrawEngine | null;
    themeMode?: ThemeMode;
    onApply: (patch: StylePatch) => void;
    onPreview: (patch: StylePatch) => void;
    run: (action: (engine: DrawEngine) => void) => void;
  } = $props();

  /** Which popover is open; one at a time. */
  let open = $state<StripItem | null>(null);
  /** Which colour picker is open — the strip's own, over the row. */
  let openPicker = $state<ColorKind | null>(null);
  /** The font list, which is a picker of its own. */
  let openFont = $state(false);

  /**
   * The width the row is drawn at, in CSS pixels: the dock's content box, which already
   * carries the safe-area insets. Read on mount and again whenever the dock is resized.
   */
  let rowWidth = $state(0);
  let row: HTMLDivElement | undefined = $state();

  function measure(): void {
    const host = row?.parentElement ?? null;
    if (!host) {
      rowWidth = typeof window === "undefined" ? 0 : window.innerWidth;
      return;
    }
    const style = getComputedStyle(host);
    rowWidth =
      host.clientWidth -
      parseFloat(style.paddingLeft || "0") -
      parseFloat(style.paddingRight || "0");
  }

  $effect(() => {
    if (!row) return;
    measure();
    const host = row.parentElement;
    if (!host) return;
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  });

  /**
   * The properties the row offers.
   *
   * With a selection, the panel's own answers. With nothing selected, the two colour
   * rows are added: they act on the next shape, which is what a person on a phone wants
   * before drawing one.
   */
  const actions = $derived(
    summary.count > 0 ? can : { ...can, strokeColor: true, backgroundColor: true },
  );
  const plan = $derived(mobileActionBarPlan(rowWidth, actions));

  const strokeRow = $derived(colorRow("stroke", summary.strokeDomain, themeMode));
  const fillRow = $derived(colorRow("background", summary.backgroundDomain, themeMode));

  /** The next shape's look, when nothing is selected: the engine's own next style. */
  const nextStyle = $derived(engine?.getNextStyle() ?? null);
  const strokeValue = $derived(
    summary.count > 0 ? summary.strokeColor : (nextStyle?.strokeColor ?? null),
  );
  const backgroundValue = $derived(
    summary.count > 0 ? summary.backgroundColor : (nextStyle?.backgroundColor ?? null),
  );

  function customColors(kind: ColorKind): () => string[] {
    return () =>
      mostUsedCustomColors(
        engine?.colorCounts(kind === "stroke" ? "strokeColor" : "backgroundColor") ?? [],
      );
  }

  /** Opens a popover, closing the others: one sheet at a time. */
  function toggleSheet(item: StripItem): void {
    open = open === item ? null : item;
    openPicker = null;
    openFont = false;
  }

  function onWindowPointerDown(event: PointerEvent): void {
    const target = event.target as Node | null;
    if (target && row?.contains(target)) return;
    open = null;
    openPicker = null;
    openFont = false;
  }

  const isPolygon = $derived(summary.isPolygon ?? false);

  /** The font family: the face is loaded first, as the panel's own row does. */
  let previewRequest = 0;
  async function previewFont(id: number | null): Promise<void> {
    const request = ++previewRequest;
    if (!engine) return;
    await loadFontFamily(document.fonts, engine.fontFamily(id ?? undefined));
    if (request === previewRequest) run((e) => e.previewFontFamily(id ?? undefined));
  }
  async function pickFont(id: number): Promise<void> {
    if (!engine) return;
    previewRequest++;
    engine.previewFontFamily(undefined);
    await loadFontFamily(document.fonts, engine.fontFamily(id));
    run((e) => e.setFontFamily(id));
  }

  /** The name each slot's button and sheet carry. */
  const slotLabel: Record<StripItem, string> = {
    stroke: "Stroke",
    background: "Background",
    "shape properties": "Shape properties",
    "arrow properties": "Arrow properties",
    polygon: "Close shape",
    text: "Text properties",
    figure: "Figure properties",
    opacity: "Opacity",
    "layer actions": "Layer actions",
  };

  /** The icon each slot's button wears. */
  const slotIcon: Record<StripItem, IconName> = {
    stroke: "rectangle",
    background: "rectangle",
    "shape properties": "rectangle",
    "arrow properties": "arrow",
    polygon: "polygonClosed",
    text: "text",
    figure: "figure",
    opacity: "opacity",
    "layer actions": "sendToBack",
  };
</script>

<svelte:window onpointerdown={onWindowPointerDown} />

<div class="mobile-strip-row" role="toolbar" aria-label="Shape actions" bind:this={row}>
  {#each plan.left as item (item)}
    {#if item === "stroke"}
      <div class="slot colour">
        <InspectorColorPicker
          label={strokeRow.label}
          kind="stroke"
          value={strokeValue}
          picks={strokeRow.picks}
          hideTransparent={strokeRow.hideTransparent}
          open={openPicker === "stroke"}
          customColors={customColors("stroke")}
          onToggle={(isOpen) => (openPicker = isOpen ? "stroke" : null)}
          onPick={(color) => {
            onApply({ strokeColor: color });
            openPicker = null;
          }}
          compact
        />
      </div>
    {:else if item === "background"}
      <div class="slot colour">
        <InspectorColorPicker
          label={fillRow.label}
          kind="background"
          value={backgroundValue}
          picks={fillRow.picks}
          hideTransparent={fillRow.hideTransparent}
          open={openPicker === "background"}
          customColors={customColors("background")}
          onToggle={(isOpen) => (openPicker = isOpen ? "background" : null)}
          onPick={(color) => {
            onApply({ backgroundColor: color });
            openPicker = null;
          }}
          compact
        />
      </div>
    {:else if item === "polygon"}
      <button
        type="button"
        class="tool"
        class:on={isPolygon}
        aria-pressed={isPolygon}
        aria-label="Close shape into a filled polygon"
        title="Close the line into a filled shape"
        onclick={() => run((e) => e.togglePolygon())}
      >
        <Icon name="polygonClosed" size={16} />
      </button>
    {:else}
      <div class="slot pop">
        <button
          type="button"
          class="tool"
          class:on={open === item}
          aria-label={slotLabel[item]}
          aria-haspopup="dialog"
          aria-expanded={open === item}
          title={slotLabel[item]}
          onclick={() => toggleSheet(item)}
        >
          <Icon name={slotIcon[item]} size={16} />
        </button>
      </div>
    {/if}
  {/each}

  <span class="gap" aria-hidden="true"></span>

  {#each plan.right as item (item)}
    {#if item === "undo"}
      <button
        type="button"
        class="tool"
        aria-label="Undo"
        title="Undo"
        onclick={() => run((e) => e.undo())}
      >
        <Icon name="undo" size={16} />
      </button>
    {:else if item === "redo"}
      <button
        type="button"
        class="tool"
        aria-label="Redo"
        title="Redo"
        onclick={() => run((e) => e.redo())}
      >
        <Icon name="redo" size={16} />
      </button>
    {:else if item === "duplicate"}
      {#if summary.count > 0}
        <button
          type="button"
          class="tool"
          aria-label="Duplicate selection"
          title="Duplicate selection"
          onclick={() => run((e) => e.duplicateSelection())}
        >
          <Icon name="copy" size={16} />
        </button>
      {/if}
    {:else if item === "delete"}
      {#if summary.count > 0}
        <button
          type="button"
          class="tool"
          aria-label="Delete selection"
          title="Delete selection"
          onclick={() => run((e) => e.deleteSelection())}
        >
          <Icon name="trash" size={16} />
        </button>
      {/if}
    {/if}
  {/each}
</div>

{#if open}
  <div class="sheet draw-panel" role="dialog" aria-label={slotLabel[open]}>
    {#if open === "shape properties"}
      <ShapeActionRows section="shape" {summary} {can} {engine} {onApply} {onPreview} {run} />
    {:else if open === "arrow properties"}
      <ShapeActionRows section="arrow" {summary} {can} {engine} {onApply} {onPreview} {run} />
    {:else if open === "text"}
      {#if can.text}
        <InspectorRow label="Font family">
          <InspectorFontPicker
            value={summary.fontFamily}
            open={openFont}
            sceneFamilies={() => engine?.sceneFontFamilies() ?? []}
            stackOf={(id) => engine?.fontFamily(id) ?? "sans-serif"}
            onToggle={(isOpen) => (openFont = isOpen)}
            onPick={(id) => void pickFont(id)}
            onPreview={(id) => void previewFont(id)}
          />
        </InspectorRow>
      {/if}
      <ShapeActionRows section="text" {summary} {can} {engine} {onApply} {onPreview} {run} />
    {:else if open === "figure"}
      <ShapeActionRows section="figure" {summary} {can} {engine} {onApply} {onPreview} {run} />
    {:else if open === "opacity"}
      <ShapeActionRows section="opacity" {summary} {can} {engine} {onApply} {onPreview} {run} />
    {:else if open === "layer actions"}
      <ShapeActionRows section="actions" {summary} {can} {engine} {onApply} {onPreview} {run} />
      {#if plan.overflow.includes("duplicate")}
        <InspectorRow label="Duplicate">
          <button
            type="button"
            class="sheet-action"
            aria-label="Duplicate selection"
            onclick={() => run((e) => e.duplicateSelection())}
          >
            <Icon name="copy" size={14} />
            <span>Duplicate</span>
          </button>
        </InspectorRow>
      {/if}
      {#if plan.overflow.includes("delete")}
        <InspectorRow label="Delete">
          <button
            type="button"
            class="sheet-action"
            aria-label="Delete selection"
            onclick={() => run((e) => e.deleteSelection())}
          >
            <Icon name="trash" size={14} />
            <span>Delete</span>
          </button>
        </InspectorRow>
      {/if}
    {/if}
  </div>
{/if}

<style>
  .mobile-strip-row {
    display: flex;
    align-items: center;
    justify-content: safe center;
    gap: 6px;
    max-width: 100%;
    padding: 4px;
    border-radius: 12px;
    background: var(--surface);
    border: 1px solid var(--line);
    box-shadow: var(--shadow-md);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    /* A row that does not fit scrolls rather than running off the screen. */
    overflow-x: auto;
    scrollbar-width: none;
  }

  .slot {
    display: flex;
    flex: 0 0 auto;
  }

  .tool {
    width: 32px;
    height: 32px;
    display: grid;
    place-items: center;
    border-radius: 8px;
    color: var(--ink);
  }

  .tool.on {
    color: var(--accent);
    background: var(--accent-subtle);
  }

  .gap {
    width: 1px;
    height: 20px;
    background: var(--line);
    flex: 0 0 auto;
  }

  .sheet {
    position: absolute;
    bottom: calc(100% + 8px);
    left: 50%;
    transform: translateX(-50%);
    width: min(20rem, calc(100vw - 1.5rem));
    max-height: min(55vh, 24rem);
    overflow-y: auto;
    padding: 12px;
    border-radius: 12px;
    z-index: 40;
  }

  .sheet :global(.row:last-child) {
    margin-bottom: 0;
  }

  .sheet-action {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 30px;
    padding: 0 10px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--surface);
    color: var(--ink);
    font-size: 12px;
  }
</style>
