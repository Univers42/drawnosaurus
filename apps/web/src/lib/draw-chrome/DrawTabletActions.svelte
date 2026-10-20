<script lang="ts">
  /**
   * The tablet's style panel: the oracle's compact column.
   *
   * Port of `CompactShapeActions` (`packages/excalidraw/components/Actions.tsx@1118751f:612-724`)
   * — "the collapsed, popover-driven layout used on tablets" — and of the column it is
   * drawn in (`Actions.scss@1118751f:95-179`): a narrow column of 32px icon buttons with
   * an 8px gap, each opening a popover, in place of the full inspector.
   *
   * Why the full inspector is not here: it is 216px wide and as tall as the screen, over
   * the drawing, and a tablet has room for a column of buttons where a desktop has room
   * for a panel of rows. The oracle's own answer for a tablet is this column
   * (`editorInterface.ts@1118751f:152-164`, `deriveStylesPanelMode`: a tablet is
   * `compact`).
   *
   * Which controls the column holds is `tabletActions.ts`'s plan; the rows the popovers
   * open are the phone's own (`ShapeActionRows.svelte`), so the two cannot drift.
   */
  import { tick } from "svelte";
  import type { SelectionStyle, StylePatch } from "@osionos/draw-engine/types";
  import type { DrawEngine } from "@osionos/draw-engine/engine";
  import Icon from "./Icon.svelte";
  import type { IconName } from "./icons.ts";
  import InspectorColorPicker from "./InspectorColorPicker.svelte";
  import InspectorFontPicker from "./InspectorFontPicker.svelte";
  import ShapeActionRows from "./ShapeActionRows.svelte";
  import { tabletActionPlan, type TabletAction } from "./tabletActions.ts";
  import type { ShapeActions } from "./shapeActions.ts";
  import { colorRow, type ThemeMode } from "./inspector.ts";
  import { mostUsedCustomColors, type ColorKind } from "./colors.ts";
  import { loadFontFamily } from "./fonts.ts";
  import { takeFocus } from "./focusHandback.ts";

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

  /** Which popover is open; one at a time, as the oracle's popovers are. */
  let open = $state<TabletAction | null>(null);
  /** Which colour picker is open — the column's own, over the board. */
  let openPicker = $state<ColorKind | null>(null);
  /** The font list, which is a picker of its own. */
  let openFont = $state(false);
  /** Where the popover opens, in the screen's own coordinates. */
  let place = $state({ left: 0, top: 0 });
  let panel: HTMLElement | undefined = $state();
  let dialog: HTMLDivElement | undefined = $state();
  /** The hand-back for the open popover, set once it is up. See `focusHandback.ts`. */
  let handBack: (() => void) | null = null;

  const plan = $derived(tabletActionPlan(can, summary.count > 0));

  const strokeRow = $derived(colorRow("stroke", summary.strokeDomain, themeMode));
  const fillRow = $derived(colorRow("background", summary.backgroundDomain, themeMode));

  function customColors(kind: ColorKind): () => string[] {
    return () =>
      mostUsedCustomColors(
        engine?.colorCounts(kind === "stroke" ? "strokeColor" : "backgroundColor") ?? [],
      );
  }

  /** The name each slot's button and popover carry. */
  const slotLabel: Record<TabletAction, string> = {
    stroke: "Stroke",
    background: "Background",
    "shape properties": "Shape properties",
    "arrow properties": "Arrow properties",
    "font family": "Font family",
    "text properties": "Text properties",
    duplicate: "Duplicate selection",
    delete: "Delete selection",
    actions: "Selection actions",
  };

  /** The icon each slot's button wears. */
  const slotIcon: Record<TabletAction, IconName> = {
    stroke: "rectangle",
    background: "rectangle",
    "shape properties": "adjustments",
    "arrow properties": "arrow",
    "font family": "text",
    "text properties": "textSize",
    duplicate: "copy",
    delete: "trash",
    actions: "more",
  };

  /** Opens a popover beside the column, at the button that opened it. */
  function togglePopover(item: TabletAction, event: MouseEvent): void {
    openPicker = null;
    openFont = false;
    if (open === item) {
      open = null;
      return;
    }
    const trigger = event.currentTarget as HTMLElement | null;
    if (trigger) {
      // Beside the column, level with the button, kept on screen: the popover's own
      // width is known before it is drawn, so the edge is known too.
      const width = 208;
      const height = 320;
      const at = trigger.getBoundingClientRect();
      let left = at.right + 8;
      if (left + width > window.innerWidth - 8) left = at.left - width - 8;
      if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
      place = {
        left: Math.max(8, left),
        top: Math.max(8, Math.min(at.top - 8, window.innerHeight - height - 8)),
      };
    }
    open = item;
  }

  /**
   * The popover is in the top layer, as the oracle's `PropertiesPopover` is: the panel it
   * opens from scrolls and blurs what is behind it, which makes the panel the box a
   * fixed child is placed in and clipped by (`InspectorColorPicker.svelte`'s own note).
   */
  $effect(() => {
    if (!open) return;
    void tick().then(() => {
      dialog?.showPopover();
      handBack = takeFocus(dialog);
    });
    return () => {
      handBack?.();
      handBack = null;
    };
  });

  function onWindowPointerDown(event: PointerEvent): void {
    const target = event.target as Node | null;
    if (target && (panel?.contains(target) || dialog?.contains(target))) return;
    open = null;
    openPicker = null;
    openFont = false;
  }

  /** The family is loaded first, as the panel's own row does. */
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
</script>

<svelte:window onpointerdown={onWindowPointerDown} />

<aside bind:this={panel} class="draw-panel panel" aria-label="Style panel" data-viewport-ui="side">
  <div class="column">
    {#each plan as item (item)}
      <div class="item">
        {#if item === "stroke"}
          <InspectorColorPicker
            label={strokeRow.label}
            kind="stroke"
            value={summary.strokeColor}
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
        {:else if item === "background"}
          <InspectorColorPicker
            label={fillRow.label}
            kind="background"
            value={summary.backgroundColor}
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
        {:else if item === "font family"}
          <InspectorFontPicker
            value={summary.fontFamily}
            open={openFont}
            sceneFamilies={() => engine?.sceneFontFamilies() ?? []}
            stackOf={(id) => engine?.fontFamily(id) ?? "sans-serif"}
            onToggle={(isOpen) => (openFont = isOpen)}
            onPick={(id) => void pickFont(id)}
            onPreview={(id) => void previewFont(id)}
            compact
          />
        {:else if item === "duplicate"}
          <button
            type="button"
            class="tool"
            aria-label={slotLabel[item]}
            title={slotLabel[item]}
            onclick={() => run((e) => e.duplicateSelection())}
          >
            <Icon name={slotIcon[item]} size={16} />
          </button>
        {:else if item === "delete"}
          <button
            type="button"
            class="tool"
            aria-label={slotLabel[item]}
            title={slotLabel[item]}
            onclick={() => run((e) => e.deleteSelection())}
          >
            <Icon name={slotIcon[item]} size={16} />
          </button>
        {:else}
          <button
            type="button"
            class="tool"
            class:on={open === item}
            aria-label={slotLabel[item]}
            aria-haspopup="dialog"
            aria-expanded={open === item}
            title={slotLabel[item]}
            onclick={(event) => togglePopover(item, event)}
          >
            <Icon name={slotIcon[item]} size={16} />
          </button>
        {/if}
      </div>
    {/each}
  </div>
</aside>

{#if open}
  <div
    bind:this={dialog}
    class="popover draw-panel"
    popover="manual"
    role="dialog"
    aria-label={slotLabel[open]}
    tabindex="-1"
    style:left={`${place.left}px`}
    style:top={`${place.top}px`}
    onkeydown={(event) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      open = null;
    }}
  >
    {#if open === "shape properties"}
      <ShapeActionRows section="shape" {summary} {can} {engine} {onApply} {onPreview} {run} />
      <ShapeActionRows section="opacity" {summary} {can} {engine} {onApply} {onPreview} {run} />
    {:else if open === "arrow properties"}
      <ShapeActionRows section="arrow" {summary} {can} {engine} {onApply} {onPreview} {run} />
    {:else if open === "text properties"}
      <ShapeActionRows section="text" {summary} {can} {engine} {onApply} {onPreview} {run} />
    {:else if open === "actions"}
      <ShapeActionRows section="actions" {summary} {can} {engine} {onApply} {onPreview} {run} />
    {/if}
  </div>
{/if}

<style>
  /*
    The column: the oracle's measurements (`Actions.scss@1118751f:95-179`) — 32px buttons
    in a column with an 8px gap, and the panel no taller than the screen leaves room for.
  */
  .panel {
    position: absolute;
    /*
      The panel's place: under the header, or under the tool bar's own row when the top
      bar has one (`draw-chrome.css`'s `--chrome-panel-top`).
    */
    top: var(--chrome-panel-top, 66px);
    left: 14px;
    width: fit-content;
    padding: 8px;
    border-radius: 12px;
    max-height: calc(100% - 120px);
    overflow-y: auto;
    z-index: 15;
    box-shadow: var(--shadow-md);
  }

  .column {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }

  .item {
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 32px;
  }

  .tool {
    width: 32px;
    height: 32px;
    display: grid;
    place-items: center;
    border-radius: 8px;
    color: var(--ink);
  }

  .tool:hover {
    background: var(--bg-hover);
  }

  .tool.on {
    color: var(--accent);
    background: var(--accent-subtle);
  }

  /*
    The popover: the oracle's `PropertiesPopover` opens beside the button that opened it,
    13rem wide (`Actions.tsx@1118751f:284-307`). Ours opens beside the column, at the
    button's own height, and never past the screen's edge.
  */
  .popover {
    position: fixed;
    inset: auto;
    margin: 0;
    color: inherit;
    overflow: visible;
    width: 13rem;
    max-width: calc(100vw - 90px);
    max-height: calc(100vh - 120px);
    overflow-y: auto;
    padding: 12px;
    border-radius: 10px;
    box-shadow: var(--shadow-md);
    outline: none;
    z-index: 40;
  }
</style>
