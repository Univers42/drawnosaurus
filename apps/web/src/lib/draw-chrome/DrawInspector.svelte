<script lang="ts">
  import type { Arrowhead, DrawElementStyle, SelectionStyle } from "@osionos/draw-engine/types";
  import type { DrawEngine } from "@osionos/draw-engine/engine";
  import InspectorRow from "./InspectorRow.svelte";
  import InspectorColorPicker from "./InspectorColorPicker.svelte";
  import InspectorSegmented from "./InspectorSegmented.svelte";
  import InspectorIconRow from "./InspectorIconRow.svelte";
  import InspectorIconChoice from "./InspectorIconChoice.svelte";
  import {
    EDGES,
    FILL_STYLES,
    FONT_SIZES,
    SLOPPINESS,
    STROKE_STYLES,
    TEXT_ALIGNS,
    VERTICAL_ALIGNS,
    getFillSwatches,
    getStrokeSwatches,
    roundnessFor,
    type ThemeMode,
    WIDTHS,
  } from "./inspector.ts";
  import { mostUsedCustomColors, type ColorKind } from "./colors.ts";
  import type { ShapeActions } from "./shapeActions.ts";
  import { zOrderShortcut } from "./shortcuts.ts";
  import { ARROWHEAD_KINDS, ARROWHEAD_GLYPH, ARROWHEAD_LABEL } from "./menu.ts";

  /**
   * The properties panel.
   *
   * Every value comes from `summary` — the engine's `selectionStyle()`, read once per
   * `styleRevision` — so the panel shows what the selection *is*: a value everything
   * shares, or nothing marked for a mixed one (`null`), and it follows undo, redo and a
   * peer's edit without being told about each. Every action goes through `run` (or
   * `onApply` / `onPreview` for a style patch), which asks the engine again afterwards.
   */
  let {
    summary,
    can,
    themeMode = "light",
    engine,
    openPicker,
    onOpenPicker,
    onApply,
    onPreview,
    run,
  }: {
    summary: SelectionStyle;
    /**
     * Which controls apply, given the tool and what is selected — `getShapeActions`, as
     * the surface already reads it for the panel's visibility and the S and G keys.
     * Every section below is gated on one of these rather than on an ad-hoc condition,
     * so the answers cannot drift apart.
     */
    can: ShapeActions;
    engine: DrawEngine | null;
    themeMode?: ThemeMode;
    /** Which colour picker is open — the S and G keys open them from outside. */
    openPicker: ColorKind | null;
    onOpenPicker: (kind: ColorKind | null) => void;
    /** Applies a style to the selection, or to the next element with nothing selected. */
    onApply: (patch: Partial<DrawElementStyle>) => void;
    /** Shows a style without committing it — a slider in motion. */
    onPreview: (patch: Partial<DrawElementStyle>) => void;
    /** Runs an engine action and reads the panel back. */
    run: (action: (engine: DrawEngine) => void) => void;
  } = $props();

  const strokePresets = $derived(getStrokeSwatches(themeMode));
  const fillPresets = $derived(getFillSwatches(themeMode));

  /** The element type reads as a heading, so it is capitalised rather than raw. */
  const title = $derived.by(() => {
    if (summary.count > 1) return `${summary.count} selected`;
    const kind = summary.count === 1 ? summary.kinds[0] : undefined;
    if (!kind) return "Style";
    return kind.charAt(0).toUpperCase() + kind.slice(1);
  });

  function customColors(kind: ColorKind): () => string[] {
    return () =>
      mostUsedCustomColors(
        engine?.colorCounts(kind === "stroke" ? "strokeColor" : "backgroundColor") ?? [],
      );
  }

  /**
   * Whether the slider has previewed since it last committed. A release commits whatever
   * the value: Chromium fires no `change` when the thumb is let go where it started, and
   * until a commit the previewed elements are mid-gesture, so a colleague's newer copy of
   * them is refused. Once, whichever of `change` and the release comes first.
   */
  let previewing = false;

  function commitOpacity(value: string): void {
    if (!previewing) return;
    previewing = false;
    onApply({ opacity: Number(value) });
  }

  /** What the slider shows for a mixed selection: the next element's, as the oracle's does. */
  const opacity = $derived(summary.opacity ?? engine?.getNextStyle().opacity ?? 100);
  const opacityText = $derived(summary.opacity === null ? "mixed" : `${summary.opacity}%`);

  const arrowheadSides = $derived([
    { end: "start" as const, value: summary.startArrowhead },
    { end: "end" as const, value: summary.endArrowhead },
  ]);

  function setArrowhead(end: "start" | "end", kind: Arrowhead): void {
    run((e) => e.setArrowheads({ [end]: kind }));
  }
</script>

<aside class="draw-panel panel" aria-label="Style inspector">
  <div class="title">{title}</div>

  <!-- In the oracle's order (`components/Actions.tsx@1118751f:168-200`). -->
  {#if can.strokeColor}
    <InspectorRow label="Stroke">
      <InspectorColorPicker
        label="Stroke"
        kind="stroke"
        value={summary.strokeColor}
        picks={strokePresets}
        open={openPicker === "stroke"}
        customColors={customColors("stroke")}
        onToggle={(open) => onOpenPicker(open ? "stroke" : null)}
        onPick={(color) => onApply({ strokeColor: color })}
      />
    </InspectorRow>
  {/if}
  {#if can.backgroundColor}
    <InspectorRow label="Background">
      <InspectorColorPicker
        label="Background"
        kind="background"
        value={summary.backgroundColor}
        picks={fillPresets}
        open={openPicker === "background"}
        customColors={customColors("background")}
        onToggle={(open) => onOpenPicker(open ? "background" : null)}
        onPick={(color) => onApply({ backgroundColor: color })}
      />
    </InspectorRow>
  {/if}
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
  <!--
    The text rows read the label of a selected shape as well as a selected text: once a
    shape has a label, the shape is the only thing a click can select. The font family
    goes above the size, as the oracle has it.
  -->
  {#if can.text}
    <InspectorRow label="Font size">
      <InspectorSegmented
        ariaLabel="Font size"
        options={FONT_SIZES}
        value={summary.fontSize}
        onPick={(v) => run((e) => e.setFontSize(Number(v)))}
      />
    </InspectorRow>
  {/if}
  {#if can.text && can.textAlign}
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
                onmousedown={(event) => event.preventDefault()}
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
  <!--
    0 to 100 in tens, as the oracle's range is (`actionProperties.tsx@1118751f:984-994`).
    Dragging previews on the canvas and commits once on release, so a drag is one step
    of undo rather than one per notch.
  -->
  {#if can.opacity}
    <InspectorRow label={`Opacity — ${opacityText}`}>
      <input
        type="range"
        min={0}
        max={100}
        step={10}
        value={opacity}
        aria-label="Opacity"
        aria-valuetext={opacityText}
        oninput={(e) => {
          previewing = true;
          onPreview({ opacity: Number(e.currentTarget.value) });
        }}
        onchange={(e) => commitOpacity(e.currentTarget.value)}
        onpointerup={(e) => commitOpacity(e.currentTarget.value)}
      />
    </InspectorRow>
  {/if}
  {#if can.layers && engine}
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
  {#if can.mirror && engine}
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
  <!--
    Shown from two elements up, and also for a single selection that is already a
    group, which is the only way to ungroup one.
  -->
  {#if engine && (summary.count >= 2 || summary.isGroup)}
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
  {#if can.align && engine}
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
  {#if can.distribute && engine}
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
</aside>

<style>
  .panel {
    position: absolute;
    top: 66px;
    left: 14px;
    width: 216px;
    padding: 14px;
    border-radius: 12px;
    max-height: calc(100% - 120px);
    overflow-y: auto;
    z-index: 15;
    box-shadow: var(--shadow-md);
    transition: opacity 0.15s ease;
  }

  .title {
    font-size: 12px;
    font-weight: 700;
    margin-bottom: 14px;
    color: var(--fg-strong);
  }

  input[type="range"] {
    width: 100%;
    accent-color: var(--accent);
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
    flex: 1;
    height: 26px;
    padding: 0;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--fg-strong);
    font-size: 13px;
    line-height: 1;
    cursor: pointer;
  }

  .heads button:hover {
    background: var(--surface);
  }

  .heads button.on {
    background: var(--accent);
    color: #ffffff;
  }

  /* The start head points the other way, so the same glyph is mirrored rather than
     carried as a second set of icons. */
  .flip {
    display: inline-block;
    transform: scaleX(-1);
  }
</style>
