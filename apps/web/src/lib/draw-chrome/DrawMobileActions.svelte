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
  import type { DrawElementStyle, SelectionStyle, StylePatch } from "@osionos/draw-engine/types";
  import type { DrawEngine } from "@osionos/draw-engine/engine";
  import Icon from "./Icon.svelte";
  import type { IconName } from "./icons.ts";
  import InspectorRow from "./InspectorRow.svelte";
  import InspectorColorPicker from "./InspectorColorPicker.svelte";
  import InspectorSegmented from "./InspectorSegmented.svelte";
  import InspectorIconChoice from "./InspectorIconChoice.svelte";
  import InspectorIconRow from "./InspectorIconRow.svelte";
  import InspectorFontPicker from "./InspectorFontPicker.svelte";
  import { mobileActionBarPlan, type StripItem } from "./mobileActions.ts";
  import type { ShapeActions } from "./shapeActions.ts";
  import {
    ARROW_TYPES,
    EDGES,
    FIGURE_KIND_OPTIONS,
    FIGURE_RATIO_RANGE,
    FIGURE_SIDES_RANGE,
    FILL_STYLES,
    FONT_SIZES,
    SLOPPINESS,
    STROKE_STYLES,
    TEXT_ALIGNS,
    TEXT_WRAPS,
    VERTICAL_ALIGNS,
    colorRow,
    roundnessFor,
    textWrap,
    type ThemeMode,
    WIDTHS,
  } from "./inspector.ts";
  import { loadFontFamily, readFontSize } from "./fonts.ts";
  import { mostUsedCustomColors, type ColorKind } from "./colors.ts";
  import { zOrderShortcut } from "./shortcuts.ts";
  import { ARROWHEAD_KINDS, ARROWHEAD_GLYPH, ARROWHEAD_LABEL } from "./menu.ts";

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
  const opacity = $derived(summary.opacity ?? engine?.getNextStyle().opacity ?? 100);
  const opacityText = $derived(summary.opacity === null ? "mixed" : `${summary.opacity}%`);
  const figureRatio = $derived(
    summary.figureRatio ?? (FIGURE_RATIO_RANGE.min + FIGURE_RATIO_RANGE.max) / 2,
  );
  const figureRatioText = $derived(
    summary.figureRatio === null ? "mixed" : summary.figureRatio.toFixed(2),
  );
  const wrap = $derived(textWrap(summary));
  const arrowheadSides = $derived([
    { end: "start" as const, value: summary.startArrowhead },
    { end: "end" as const, value: summary.endArrowhead },
  ]);

  /** The drag of a slider previews and commits once, as the panel's own do. */
  let previewing = false;
  function commitOpacity(value: string): void {
    if (!previewing) return;
    previewing = false;
    onApply({ opacity: Number(value) });
  }
  let previewingRatio = false;
  function commitFigureRatio(value: string): void {
    if (!previewingRatio) return;
    previewingRatio = false;
    onApply({ figureRatio: Number(value) });
  }

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

  function setArrowhead(end: "start" | "end", kind: (typeof ARROWHEAD_KINDS)[number]): void {
    run((e) => e.setArrowheads({ [end]: kind }));
  }
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
      {#if can.fill}
        <InspectorRow label="Fill style">
          <InspectorSegmented
            ariaLabel="Fill style"
            options={FILL_STYLES}
            value={summary.fillStyle}
            onPick={(v) => onApply({ fillStyle: v as DrawElementStyle["fillStyle"] })}
          />
        </InspectorRow>
      {/if}
      {#if can.strokeWidth}
        <InspectorRow label="Width">
          <InspectorSegmented
            ariaLabel="Stroke width"
            options={WIDTHS}
            value={summary.strokeWidth}
            onPick={(v) => onApply({ strokeWidth: Number(v) })}
          />
        </InspectorRow>
      {/if}
      {#if can.strokeStyle}
        <InspectorRow label="Stroke style">
          <InspectorSegmented
            ariaLabel="Stroke style"
            options={STROKE_STYLES}
            value={summary.strokeStyle}
            onPick={(v) => onApply({ strokeStyle: v as DrawElementStyle["strokeStyle"] })}
          />
        </InspectorRow>
      {/if}
      {#if can.sloppiness}
        <InspectorRow label="Sloppiness">
          <InspectorSegmented
            ariaLabel="Sloppiness"
            options={SLOPPINESS}
            value={summary.roughness}
            onPick={(v) => onApply({ roughness: Number(v) })}
          />
        </InspectorRow>
      {/if}
      {#if can.roundness}
        <InspectorRow label="Edges">
          <InspectorSegmented
            ariaLabel="Edges"
            options={EDGES}
            value={summary.edges}
            onPick={(v) => onApply({ roundness: roundnessFor(v === "round" ? "round" : "sharp") })}
          />
        </InspectorRow>
      {/if}
    {:else if open === "arrow properties"}
      {#if can.arrowType}
        <InspectorRow label="Arrow type">
          <InspectorIconChoice
            ariaLabel="Arrow type"
            options={ARROW_TYPES}
            value={summary.arrowType}
            onPick={(v) => run((e) => e.setArrowType(v))}
          />
        </InspectorRow>
      {/if}
      {#if can.arrowheads}
        <InspectorRow label="Arrowheads">
          <div class="arrowheads">
            {#each arrowheadSides as side (side.end)}
              <div
                class="heads"
                role="radiogroup"
                aria-label={`${side.end === "start" ? "Start" : "End"} arrowhead`}
              >
                {#each ARROWHEAD_KINDS as kind (kind)}
                  <button
                    type="button"
                    role="radio"
                    class:on={side.value === kind}
                    aria-checked={side.value === kind}
                    aria-label={`${side.end === "start" ? "Start" : "End"} ${ARROWHEAD_LABEL[kind]}`}
                    title={ARROWHEAD_LABEL[kind]}
                    onclick={() => setArrowhead(side.end, kind)}
                  >
                    <span class:flip={side.end === "start"}>{ARROWHEAD_GLYPH[kind]}</span>
                  </button>
                {/each}
              </div>
            {/each}
          </div>
        </InspectorRow>
      {/if}
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
        <InspectorRow label="Font size">
          <div class="font-size">
            <InspectorSegmented
              ariaLabel="Font size"
              options={FONT_SIZES}
              value={summary.fontSize}
              onPick={(v) => run((e) => e.setFontSize(Number(v)))}
            />
            <input
              type="number"
              min={1}
              max={1000}
              step={1}
              aria-label="Font size in pixels"
              placeholder="mixed"
              value={summary.fontSize ?? ""}
              onchange={(event) => {
                const size = readFontSize(event.currentTarget.value);
                if (size !== null) run((e) => e.setFontSize(size));
              }}
            />
          </div>
        </InspectorRow>
      {/if}
      {#if can.textAlign}
        <InspectorRow label="Text align">
          <InspectorIconChoice
            ariaLabel="Text alignment"
            options={TEXT_ALIGNS}
            value={summary.textAlign}
            onPick={(v) => run((e) => e.setTextAlign(v))}
          />
        </InspectorRow>
      {/if}
      {#if can.verticalAlign}
        <InspectorRow label="Vertical align">
          <InspectorIconChoice
            ariaLabel="Vertical text alignment"
            options={VERTICAL_ALIGNS}
            value={summary.verticalAlign}
            onPick={(v) => run((e) => e.setVerticalAlign(v))}
          />
        </InspectorRow>
      {/if}
      {#if can.wrap}
        <InspectorRow label="Text wrap">
          <InspectorSegmented
            ariaLabel="Text wrap"
            options={TEXT_WRAPS}
            value={wrap}
            onPick={(v) => run((e) => e.setTextWrap(v === "wrap"))}
          />
        </InspectorRow>
      {/if}
    {:else if open === "figure"}
      {#if can.figureKind}
        <InspectorRow label="Shape">
          <InspectorIconChoice
            ariaLabel="Shape"
            options={FIGURE_KIND_OPTIONS}
            value={summary.figureKind}
            onPick={(v) => onApply({ figureKind: v })}
          />
        </InspectorRow>
      {/if}
      {#if can.figureSides}
        <InspectorRow label="Sides">
          <input
            type="number"
            min={FIGURE_SIDES_RANGE.min}
            max={FIGURE_SIDES_RANGE.max}
            step={1}
            aria-label="Sides"
            placeholder="mixed"
            value={summary.figureSides ?? ""}
            onchange={(event) => {
              const sides = Number(event.currentTarget.value);
              if (Number.isFinite(sides)) onApply({ figureSides: sides });
            }}
          />
        </InspectorRow>
      {/if}
      {#if can.figureRatio}
        <InspectorRow label={`Ratio — ${figureRatioText}`}>
          <input
            type="range"
            min={FIGURE_RATIO_RANGE.min}
            max={FIGURE_RATIO_RANGE.max}
            step={FIGURE_RATIO_RANGE.step}
            value={figureRatio}
            aria-label="Ratio"
            aria-valuetext={figureRatioText}
            oninput={(event) => {
              previewingRatio = true;
              onPreview({ figureRatio: Number(event.currentTarget.value) });
            }}
            onchange={(event) => commitFigureRatio(event.currentTarget.value)}
            onpointerup={(event) => commitFigureRatio(event.currentTarget.value)}
          />
        </InspectorRow>
      {/if}
    {:else if open === "opacity"}
      <InspectorRow label={`Opacity — ${opacityText}`}>
        <input
          type="range"
          min={0}
          max={100}
          step={10}
          value={opacity}
          aria-label="Opacity"
          aria-valuetext={opacityText}
          oninput={(event) => {
            previewing = true;
            onPreview({ opacity: Number(event.currentTarget.value) });
          }}
          onchange={(event) => commitOpacity(event.currentTarget.value)}
          onpointerup={(event) => commitOpacity(event.currentTarget.value)}
        />
      </InspectorRow>
    {:else if open === "layer actions"}
      {#if can.layers}
        <InspectorRow label="Layers">
          <InspectorIconRow
            buttons={[
              {
                label: `Send to back (${zOrderShortcut("back")})`,
                icon: "sendToBack",
                onPick: () => run((e) => e.reorderSelection("back")),
              },
              {
                label: `Send backward (${zOrderShortcut("backward")})`,
                icon: "backward",
                onPick: () => run((e) => e.reorderSelection("backward")),
              },
              {
                label: `Bring forward (${zOrderShortcut("forward")})`,
                icon: "forward",
                onPick: () => run((e) => e.reorderSelection("forward")),
              },
              {
                label: `Bring to front (${zOrderShortcut("front")})`,
                icon: "bringToFront",
                onPick: () => run((e) => e.reorderSelection("front")),
              },
            ]}
          />
        </InspectorRow>
      {/if}
      {#if can.mirror}
        <InspectorRow label="Mirror">
          <InspectorIconRow
            buttons={[
              {
                label: "Flip horizontally",
                icon: "flipHorizontal",
                onPick: () => run((e) => e.flipSelection("horizontal")),
              },
              {
                label: "Flip vertically",
                icon: "flipVertical",
                onPick: () => run((e) => e.flipSelection("vertical")),
              },
            ]}
          />
        </InspectorRow>
      {/if}
      {#if can.group}
        <InspectorRow label="Group">
          <InspectorIconRow
            buttons={[
              {
                label: "Group selection",
                icon: "group",
                onPick: () => run((e) => e.groupSelection()),
              },
              {
                label: "Ungroup selection",
                icon: "ungroup",
                onPick: () => run((e) => e.ungroupSelection()),
              },
            ]}
          />
        </InspectorRow>
      {/if}
      {#if can.align}
        <InspectorRow label="Align">
          <InspectorIconRow
            buttons={[
              {
                label: "Align left",
                icon: "alignLeft",
                onPick: () => run((e) => e.alignSelection("left")),
              },
              {
                label: "Align horizontal centres",
                icon: "alignCenterX",
                onPick: () => run((e) => e.alignSelection("centerX")),
              },
              {
                label: "Align right",
                icon: "alignRight",
                onPick: () => run((e) => e.alignSelection("right")),
              },
              {
                label: "Align top",
                icon: "alignTop",
                onPick: () => run((e) => e.alignSelection("top")),
              },
              {
                label: "Align vertical centres",
                icon: "alignCenterY",
                onPick: () => run((e) => e.alignSelection("centerY")),
              },
              {
                label: "Align bottom",
                icon: "alignBottom",
                onPick: () => run((e) => e.alignSelection("bottom")),
              },
            ]}
          />
        </InspectorRow>
      {/if}
      {#if can.distribute}
        <InspectorRow label="Distribute">
          <InspectorIconRow
            buttons={[
              {
                label: "Distribute horizontally",
                icon: "distributeX",
                onPick: () => run((e) => e.distributeSelection("x")),
              },
              {
                label: "Distribute vertically",
                icon: "distributeY",
                onPick: () => run((e) => e.distributeSelection("y")),
              },
            ]}
          />
        </InspectorRow>
      {/if}
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

  .arrowheads {
    display: grid;
    gap: 4px;
  }

  .heads {
    display: flex;
    gap: 2px;
    padding: 2px;
    background: var(--bg);
    border-radius: 8px;
  }

  .heads button {
    flex: 1 1 22px;
    min-width: 22px;
    height: 26px;
    border-radius: 6px;
    background: transparent;
    color: var(--fg-strong);
    font-size: 13px;
    line-height: 1;
  }

  .heads button.on {
    background: var(--accent);
    color: #ffffff;
  }

  .flip {
    display: inline-block;
    transform: scaleX(-1);
  }

  .font-size {
    display: grid;
    gap: 4px;
  }

  .font-size input {
    height: 28px;
    padding: 0 8px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: var(--surface);
    color: var(--fg-strong);
    font: inherit;
    font-size: 12px;
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

  input[type="range"] {
    width: 100%;
    accent-color: var(--accent);
  }
</style>
